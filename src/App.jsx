import React, { useState, useEffect, useRef } from 'react';
import { Plus, Trash2, Copy, Wallet, TrendingUp, Search, CreditCard, Users, X, Minus, AlertTriangle, User, ChevronRight, CheckCircle, Filter, Camera, Loader2, Cloud } from 'lucide-react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged, signInWithCustomToken } from 'firebase/auth';
import { getFirestore, collection, addDoc, deleteDoc, doc, onSnapshot, query } from 'firebase/firestore';

// --- FIREBASE CONFIGURATION ---
// Внимание: При размещении на GitHub вам нужно будет вставить сюда СВОИ данные из консоли Firebase
const firebaseConfig = {
  apiKey: "AIzaSyBQT6fgGpfUpfvG0jPZlEEnz3F9_PBOsrk",
  authDomain: "family-cashback.firebaseapp.com",
  projectId: "family-cashback",
  storageBucket: "family-cashback.firebasestorage.app",
  messagingSenderId: "204398028562",
  appId: "1:204398028562:web:f8244978384234ac48f5cb"
};
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';

// Preset banks for buttons
const PRESET_BANKS = ['Т-Банк', 'СБЕР', 'Альфа', 'Ozon', 'Я.ПЭЙ'];
const PRESET_PEOPLE = ['Муж', 'Жена'];

export default function App() {
  const [entries, setEntries] = useState([]);
  const [person, setPerson] = useState(PRESET_PEOPLE[0]);
  const [user, setUser] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  
  // Bank state
  const [selectedBank, setSelectedBank] = useState('');
  const [customBank, setCustomBank] = useState('');
  const [isCustomBank, setIsCustomBank] = useState(false);

  // Categories state (batch)
  const [categoryRows, setCategoryRows] = useState([
    { category: '', percent: '' },
    { category: '', percent: '' },
    { category: '', percent: '' }
  ]);

  // OCR State
  const [isProcessingInfo, setIsProcessingInfo] = useState(false);
  const [ocrError, setOcrError] = useState(null);
  const fileInputRef = useRef(null);

  const [searchTerm, setSearchTerm] = useState('');
  const [activeTab, setActiveTab] = useState('list'); // 'list' or 'add'
  const [listPersonFilter, setListPersonFilter] = useState('Все'); 
  
  // Notification state
  const [notification, setNotification] = useState(null);
  const notificationTimeoutRef = useRef(null);

  const [showClearConfirm, setShowClearConfirm] = useState(false);

  // Inject Tesseract script
  useEffect(() => {
    if (!window.Tesseract) {
      const script = document.createElement('script');
      script.src = "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js";
      script.async = true;
      document.body.appendChild(script);
      return () => {
        try { document.body.removeChild(script); } catch (e) {}
      }
    }
  }, []);

  // --- FIREBASE AUTH & SYNC ---
  
  // 1. Authenticate
  useEffect(() => {
    const initAuth = async () => {
      if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
        await signInWithCustomToken(auth, __initial_auth_token);
      } else {
        await signInAnonymously(auth);
      }
    };
    initAuth();
    const unsubscribe = onAuthStateChanged(auth, setUser);
    return () => unsubscribe();
  }, []);

  // 2. Sync Data
  useEffect(() => {
    if (!user) return;

    // Using the 'public' path so husband and wife can share data if they use the same appId/config
    const q = query(collection(db, 'artifacts', appId, 'public', 'data', 'cashback_entries'));
    
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setEntries(data);
      setIsLoading(false);
    }, (error) => {
      console.error("Error fetching data:", error);
      showNotification('Ошибка синхронизации', 'error');
      setIsLoading(false);
    });

    return () => unsubscribe();
  }, [user]);


  // Notification handler
  const showNotification = (msg, type = 'success') => {
    if (notificationTimeoutRef.current) {
      clearTimeout(notificationTimeoutRef.current);
    }
    setNotification({ msg, type });
    notificationTimeoutRef.current = setTimeout(() => {
      setNotification(null);
      notificationTimeoutRef.current = null;
    }, 3000);
  };

  // --- OCR Logic ---
  const handleImageUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (!window.Tesseract) {
      showNotification('Библиотека OCR еще загружается...', 'error');
      return;
    }

    setIsProcessingInfo(true);
    setOcrError(null);

    try {
      const { data: { text } } = await window.Tesseract.recognize(
        file,
        'rus', 
        { logger: m => console.log(m) }
      );

      processRecognizedText(text);
      showNotification('Данные считаны!', 'success');
    } catch (err) {
      console.error(err);
      setOcrError('Не удалось распознать текст.');
      showNotification('Ошибка распознавания', 'error');
    } finally {
      setIsProcessingInfo(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const processRecognizedText = (text) => {
    const lines = text.split('\n');
    const foundItems = [];
    const percentRegex = /(\d+[.,]?\d*)\s?%/;

    lines.forEach(line => {
      const cleanLine = line.trim();
      if (!cleanLine) return;

      const match = cleanLine.match(percentRegex);
      if (match) {
        const percentStr = match[1].replace(',', '.');
        const percent = parseFloat(percentStr);
        let category = cleanLine.replace(match[0], '').trim();
        category = category.replace(/[|—_=\\/*]/g, '').trim();

        if (category.length > 2 && percent > 0) {
           foundItems.push({ category, percent });
        }
      }
    });

    if (foundItems.length > 0) {
      const newRows = [...categoryRows];
      let insertIndex = 0;
      
      foundItems.forEach((item) => {
        while (insertIndex < newRows.length && (newRows[insertIndex].category || newRows[insertIndex].percent)) {
           insertIndex++;
        }
        if (insertIndex < newRows.length) {
          newRows[insertIndex] = { category: item.category, percent: item.percent };
        } else {
          newRows.push({ category: item.category, percent: item.percent });
        }
        insertIndex++;
      });
      setCategoryRows(newRows);
    } else {
      setOcrError('Не удалось найти категории с %.');
    }
  };

  // --- Handlers using FIREBASE ---

  const handleBankSelect = (bankName) => {
    if (bankName === 'other') {
      setIsCustomBank(true);
      setSelectedBank('');
    } else {
      setIsCustomBank(false);
      setSelectedBank(bankName);
    }
  };

  const handleRowChange = (index, field, value) => {
    const newRows = [...categoryRows];
    newRows[index][field] = value;
    setCategoryRows(newRows);
  };

  const addRow = () => {
    setCategoryRows([...categoryRows, { category: '', percent: '' }]);
  };

  const removeRow = (index) => {
    if (categoryRows.length === 1) return; 
    const newRows = categoryRows.filter((_, i) => i !== index);
    setCategoryRows(newRows);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!user) return;
    
    const bankName = isCustomBank ? customBank : selectedBank;
    if (!bankName) {
      showNotification('Выберите банк', 'error');
      return;
    }

    const itemsToAdd = [];
    let hasError = false;

    for (const row of categoryRows) {
      const cat = row.category.toString().trim();
      const pct = row.percent;

      if (!cat && !pct) continue;

      if (cat && !pct) {
        showNotification(`Укажите % для "${cat}"`, 'error');
        hasError = true;
        break; 
      }
      if (!cat && pct) {
        showNotification(`Укажите категорию для ${pct}%`, 'error');
        hasError = true;
        break;
      }

      itemsToAdd.push({
        person,
        bank: bankName,
        category: cat,
        percent: parseFloat(pct),
        createdAt: new Date().toISOString()
      });
    }

    if (hasError) return;
    if (itemsToAdd.length === 0) {
      showNotification('Заполните хотя бы одну строку', 'error');
      return;
    }

    // Add to Firebase
    try {
      const collectionRef = collection(db, 'artifacts', appId, 'public', 'data', 'cashback_entries');
      await Promise.all(itemsToAdd.map(item => addDoc(collectionRef, item)));
      
      setCategoryRows([
        { category: '', percent: '' },
        { category: '', percent: '' },
        { category: '', percent: '' }
      ]);
      setOcrError(null);
      showNotification(`Сохранено!`, 'success');
    } catch (e) {
      console.error(e);
      showNotification('Ошибка сохранения', 'error');
    }
  };

  const handleDelete = async (id) => {
    if (!user) return;
    try {
      await deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'cashback_entries', id));
      // No need to update state manually, onSnapshot will handle it
    } catch (e) {
      console.error(e);
      showNotification('Ошибка удаления', 'error');
    }
  };

  const confirmClearAll = async () => {
    if (!user) return;
    try {
      // Firebase doesn't support "delete collection", so we must delete docs one by one
      // In a real app, you'd use a cloud function or batching. For this scale, loop is fine.
      const promises = entries.map(entry => 
        deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'cashback_entries', entry.id))
      );
      await Promise.all(promises);
      
      setShowClearConfirm(false);
      showNotification('Список очищен', 'success');
    } catch (e) {
      showNotification('Ошибка очистки', 'error');
    }
  };

  const generateReport = () => {
    if (entries.length === 0) return;

    const groupedByPerson = entries.reduce((acc, item) => {
      if (!acc[item.person]) acc[item.person] = [];
      acc[item.person].push(item);
      return acc;
    }, {});

    let text = "📊 *Кешбэк на этот месяц:*\n\n";

    const sortedPeople = Object.keys(groupedByPerson).sort((a, b) => {
        const idxA = PRESET_PEOPLE.indexOf(a);
        const idxB = PRESET_PEOPLE.indexOf(b);
        if (idxA !== -1 && idxB !== -1) return idxA - idxB;
        return a.localeCompare(b);
    });

    sortedPeople.forEach(personName => {
      text += `👤 *${personName.toUpperCase()}*\n`;
      const personEntries = groupedByPerson[personName];
      const groupedByBank = personEntries.reduce((acc, item) => {
        if (!acc[item.bank]) acc[item.bank] = [];
        acc[item.bank].push(item);
        return acc;
      }, {});

      const sortedBanks = Object.keys(groupedByBank).sort();

      sortedBanks.forEach(bankName => {
        const items = groupedByBank[bankName].sort((a, b) => b.percent - a.percent);
        text += `\n🏦 *${bankName}*\n`;
        items.forEach(item => {
          text += `   • ${item.category}: ${item.percent}%\n`;
        });
      });
      text += "\n------------------\n\n";
    });

    try {
      const textArea = document.createElement("textarea");
      textArea.value = text;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
      showNotification('Отчет скопирован!', 'success');
    } catch (err) {
      showNotification('Ошибка копирования', 'error');
    }
  };

  // Data Preparation for Render
  const prepareRenderData = () => {
    let filtered = entries.filter(e => 
      e.category.toLowerCase().includes(searchTerm.toLowerCase()) ||
      e.bank.toLowerCase().includes(searchTerm.toLowerCase())
    ).sort((a, b) => b.percent - a.percent);

    if (listPersonFilter !== 'Все') {
      filtered = filtered.filter(e => e.person === listPersonFilter);
    }

    const structure = {};
    filtered.forEach(entry => {
      if (!structure[entry.person]) structure[entry.person] = {};
      if (!structure[entry.person][entry.bank]) structure[entry.person][entry.bank] = [];
      structure[entry.person][entry.bank].push(entry);
    });

    return structure;
  };

  const groupedData = prepareRenderData();
  const sortedPeopleKeys = Object.keys(groupedData).sort((a, b) => {
    const idxA = PRESET_PEOPLE.indexOf(a);
    const idxB = PRESET_PEOPLE.indexOf(b);
    if (idxA !== -1 && idxB !== -1) return idxA - idxB;
    return a.localeCompare(b);
  });

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 font-sans pb-24 md:pb-0 relative">
      
      {/* Confirmation Modal */}
      {showClearConfirm && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-fade-in">
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-2xl transform transition-all scale-100">
            <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mb-4 mx-auto">
              <AlertTriangle className="text-red-500 w-6 h-6" />
            </div>
            <h3 className="text-xl font-bold text-slate-800 mb-2 text-center">Очистить всё?</h3>
            <p className="text-slate-500 mb-6 text-center text-sm">
              Это действие удалит все добавленные категории. Вы хотите начать новый месяц?
            </p>
            <div className="flex gap-3">
              <button 
                onClick={() => setShowClearConfirm(false)}
                className="flex-1 py-3 font-semibold text-slate-600 bg-slate-100 rounded-xl hover:bg-slate-200 transition-colors"
              >
                Отмена
              </button>
              <button 
                onClick={confirmClearAll}
                className="flex-1 py-3 font-semibold text-white bg-red-500 rounded-xl hover:bg-red-600 transition-colors shadow-lg shadow-red-100"
              >
                Да, удалить
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <header className="bg-blue-600 text-white p-4 shadow-lg sticky top-0 z-20">
        <div className="max-w-md mx-auto flex justify-between items-center">
          <div className="flex items-center gap-2">
            <Cloud className="w-6 h-6" />
            <h1 className="text-xl font-bold tracking-tight">Family Cashback</h1>
          </div>
          <div className="text-sm bg-blue-500 px-3 py-1 rounded-full font-medium shadow-sm border border-blue-400">
            {entries.length} шт.
          </div>
        </div>
      </header>

      <main className="max-w-md mx-auto p-4">
        
        {/* Notification Toast */}
        {notification && (
          <div className={`fixed top-20 left-1/2 transform -translate-x-1/2 px-5 py-3 rounded-xl shadow-2xl z-50 animate-fade-in-down flex items-center gap-3 text-sm font-bold ${notification.type === 'error' ? 'bg-red-500 text-white' : 'bg-slate-800 text-white'}`}>
            {notification.type === 'error' ? <AlertTriangle size={20} className="text-white" /> : <CheckCircle size={20} className="text-green-400" />}
            <span>{notification.msg}</span>
          </div>
        )}

        {/* Tabs */}
        <div className="flex bg-white rounded-xl shadow-sm p-1 mb-6 border border-slate-100">
          <button 
            onClick={() => setActiveTab('list')}
            className={`flex-1 py-2.5 rounded-lg text-sm font-bold transition-all flex justify-center items-center gap-2 ${activeTab === 'list' ? 'bg-blue-50 text-blue-600 shadow-sm ring-1 ring-blue-100' : 'text-gray-400 hover:text-gray-600'}`}
          >
            <TrendingUp size={18} /> Список
          </button>
          <button 
            onClick={() => setActiveTab('add')}
            className={`flex-1 py-2.5 rounded-lg text-sm font-bold transition-all flex justify-center items-center gap-2 ${activeTab === 'add' ? 'bg-blue-50 text-blue-600 shadow-sm ring-1 ring-blue-100' : 'text-gray-400 hover:text-gray-600'}`}
          >
            <Plus size={18} /> Добавить
          </button>
        </div>

        {/* ADD NEW FORM */}
        {activeTab === 'add' && (
          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-5 animate-fade-in">
            <form onSubmit={handleSubmit} className="space-y-6">
              
              {/* Person Select */}
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase mb-2 tracking-wider">Чья карта?</label>
                <div className="flex gap-2">
                  {PRESET_PEOPLE.map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setPerson(p)}
                      className={`flex-1 py-2.5 rounded-xl text-sm font-bold border-2 transition-all ${person === p ? 'border-blue-500 bg-blue-50 text-blue-700 shadow-sm' : 'border-slate-100 bg-slate-50 text-slate-500 hover:border-slate-200'}`}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>

              {/* Bank Select Buttons */}
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase mb-2 tracking-wider">Банк</label>
                <div className="grid grid-cols-3 gap-2 mb-2">
                  {PRESET_BANKS.map(b => (
                    <button
                      key={b}
                      type="button"
                      onClick={() => handleBankSelect(b)}
                      className={`py-2 px-1 rounded-xl text-sm font-semibold border-2 transition-all truncate ${!isCustomBank && selectedBank === b ? 'border-indigo-500 bg-indigo-50 text-indigo-700 shadow-sm' : 'border-slate-100 bg-slate-50 text-slate-600 hover:bg-slate-100'}`}
                    >
                      {b}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => handleBankSelect('other')}
                    className={`py-2 px-1 rounded-xl text-sm font-semibold border-2 transition-all ${isCustomBank ? 'border-indigo-500 bg-indigo-50 text-indigo-700 shadow-sm' : 'border-slate-100 bg-slate-50 text-slate-400 hover:bg-slate-100'}`}
                  >
                    Другой...
                  </button>
                </div>
                
                {isCustomBank && (
                  <input
                    type="text"
                    value={customBank}
                    onChange={(e) => setCustomBank(e.target.value)}
                    placeholder="Введите название банка"
                    className="w-full p-3 bg-white border-2 border-indigo-100 rounded-xl focus:outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 transition-all animate-fade-in"
                    autoFocus
                  />
                )}
              </div>
              
              {/* SCANNER BUTTON */}
              <div>
                 <input
                    type="file"
                    accept="image/*"
                    ref={fileInputRef}
                    className="hidden"
                    onChange={handleImageUpload}
                 />
                 <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isProcessingInfo}
                    className="w-full py-3 bg-indigo-50 border-2 border-dashed border-indigo-200 text-indigo-600 rounded-xl hover:bg-indigo-100 hover:border-indigo-300 transition-all flex items-center justify-center gap-2 font-bold relative overflow-hidden"
                 >
                    {isProcessingInfo ? (
                       <>
                         <Loader2 className="animate-spin w-5 h-5" />
                         Распознаем текст...
                       </>
                    ) : (
                       <>
                         <Camera className="w-5 h-5" />
                         Скан по фото (Beta)
                       </>
                    )}
                 </button>
                 {ocrError && <p className="text-red-500 text-xs mt-2 text-center">{ocrError}</p>}
                 <p className="text-slate-400 text-[10px] text-center mt-1">
                   Работает лучше всего, если виден текст "Категория 5%"
                 </p>
              </div>

              {/* Categories Batch Input */}
              <div>
                <div className="flex justify-between items-end mb-2">
                  <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider">Категории и %</label>
                  <div className="text-[10px] text-slate-400 font-medium bg-slate-100 px-2 py-0.5 rounded-full">
                    {categoryRows.length} стр.
                  </div>
                </div>
                
                <div className="space-y-2">
                  {categoryRows.map((row, index) => (
                    <div key={index} className="flex gap-2 items-center animate-fade-in" style={{ animationDelay: `${index * 50}ms` }}>
                      <div className="flex-1 relative">
                        <input
                          type="text"
                          value={row.category}
                          onChange={(e) => handleRowChange(index, 'category', e.target.value)}
                          placeholder="Категория (напр. Такси)"
                          className={`w-full pl-3 pr-3 py-3 bg-slate-50 border rounded-xl focus:outline-none focus:ring-2 focus:bg-white transition-all text-sm ${row.category && !row.percent ? 'border-red-300 ring-1 ring-red-100' : 'border-slate-200 focus:ring-blue-500'}`}
                        />
                      </div>
                      <div className="w-20 relative">
                        <input
                          type="number"
                          value={row.percent}
                          onChange={(e) => handleRowChange(index, 'percent', e.target.value)}
                          placeholder="%"
                          className={`w-full py-3 bg-slate-50 border rounded-xl focus:outline-none focus:ring-2 focus:bg-white text-center font-bold text-blue-600 transition-all text-sm ${!row.category && row.percent ? 'border-red-300 ring-1 ring-red-100' : 'border-slate-200 focus:ring-blue-500'}`}
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => removeRow(index)}
                        className="w-10 h-10 flex items-center justify-center text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-xl transition-colors"
                        disabled={categoryRows.length === 1}
                      >
                        {index === categoryRows.length - 1 && categoryRows.length > 1 ? <Trash2 size={18} /> : <Minus size={18} />}
                      </button>
                    </div>
                  ))}
                </div>

                {/* Add Row Button */}
                <button
                  type="button"
                  onClick={addRow}
                  className="mt-3 w-full py-2 border-2 border-dashed border-slate-200 text-slate-400 rounded-xl hover:border-blue-300 hover:text-blue-500 hover:bg-blue-50 transition-all flex items-center justify-center gap-2 text-sm font-semibold"
                >
                  <Plus size={16} /> Добавить строку
                </button>
              </div>

              <button
                type="submit"
                className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-4 rounded-xl shadow-lg shadow-blue-200 active:scale-95 transition-all flex justify-center items-center gap-2 text-lg"
              >
                <Plus size={22} /> Сохранить всё
              </button>
            </form>
          </div>
        )}

        {/* LIST VIEW */}
        {activeTab === 'list' && (
          <div className="animate-fade-in pb-24">
            
            {/* Control Bar: Search + Filter */}
            <div className="space-y-3 mb-6">
              
              {/* Filter Tabs */}
              <div className="flex bg-slate-200/50 p-1 rounded-xl">
                {['Все', ...PRESET_PEOPLE].map((filterName) => (
                   <button
                     key={filterName}
                     onClick={() => setListPersonFilter(filterName)}
                     className={`flex-1 py-1.5 text-xs font-bold rounded-lg transition-all ${listPersonFilter === filterName ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                   >
                     {filterName}
                   </button>
                ))}
              </div>

              {/* Search */}
              <div className="relative">
                <Search className="absolute left-3 top-3.5 text-slate-400 w-5 h-5" />
                <input 
                  type="text" 
                  placeholder="Поиск (Рестораны, Такси...)" 
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-10 pr-4 py-3 bg-white border border-slate-200 rounded-xl shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                />
                {searchTerm && (
                  <button 
                    onClick={() => setSearchTerm('')}
                    className="absolute right-3 top-3.5 text-slate-400 hover:text-slate-600 p-0.5 rounded-full hover:bg-slate-100"
                  >
                    <X size={16} />
                  </button>
                )}
              </div>
            </div>

            {/* Empty State */}
            {entries.length === 0 && (
              <div className="text-center py-16 text-slate-400">
                <div className="bg-slate-100 w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-4 shadow-inner">
                  <Wallet className="w-10 h-10 opacity-40 text-slate-500" />
                </div>
                <p className="text-lg font-medium text-slate-500">Список пуст</p>
                <p className="text-sm opacity-70 mt-1">Перейдите на вкладку "Добавить"</p>
              </div>
            )}

            {/* NESTED Grouped Lists (Person -> Bank Grid) */}
            <div className="space-y-8">
              {sortedPeopleKeys.map(personName => (
                <div key={personName} className="animate-fade-in">
                  
                  {/* Person Header (Only show if viewing 'All') */}
                  {listPersonFilter === 'Все' && (
                    <div className="flex items-center gap-2 mb-3 px-1">
                      <span className={`p-1.5 rounded-lg ${personName === 'Муж' ? 'bg-indigo-100 text-indigo-600' : 'bg-pink-100 text-pink-600'}`}>
                        <User size={16} />
                      </span>
                      <h3 className="font-bold text-slate-600 text-sm uppercase tracking-wide">{personName}</h3>
                    </div>
                  )}
                  
                  {/* Banks Grid (Masonry-like layout) */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {Object.keys(groupedData[personName]).sort().map(bankName => (
                      <div key={bankName} className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden flex flex-col h-full">
                        
                        {/* Compact Bank Header */}
                        <div className="bg-slate-50 px-3 py-2 border-b border-slate-100 flex justify-between items-center">
                          <h4 className="font-bold text-slate-700 text-sm flex items-center gap-2">
                             <CreditCard className="w-3.5 h-3.5 text-slate-400" />
                             {bankName}
                          </h4>
                        </div>

                        {/* Compact Categories List */}
                        <div className="divide-y divide-slate-50 flex-1">
                          {groupedData[personName][bankName].map(entry => (
                            <div key={entry.id} className="p-2.5 px-3 flex justify-between items-center hover:bg-slate-50 transition-colors group">
                              <span className="font-medium text-slate-700 text-sm leading-tight">{entry.category}</span>
                              <div className="flex items-center gap-2">
                                <span className="font-extrabold text-blue-600 text-sm tabular-nums">
                                  {entry.percent}%
                                </span>
                                <button 
                                  onClick={() => handleDelete(entry.id)}
                                  className="w-6 h-6 flex items-center justify-center text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-full transition-all opacity-0 group-hover:opacity-100 focus:opacity-100"
                                  title="Удалить"
                                >
                                  <Trash2 size={14} />
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>

                </div>
              ))}
            </div>

            {/* Actions */}
            {entries.length > 0 && (
              <div className="pt-8 space-y-3">
                <button 
                  onClick={generateReport}
                  className="w-full bg-slate-800 hover:bg-slate-900 text-white font-bold py-3.5 rounded-xl shadow-lg active:scale-95 transition-all flex justify-center items-center gap-2"
                >
                  <Copy size={18} /> Скопировать отчет
                </button>
                
                <button 
                  onClick={() => setShowClearConfirm(true)}
                  className="w-full text-red-400 hover:text-red-600 hover:bg-red-50 font-medium py-3 rounded-xl transition-all text-sm"
                >
                  Сбросить всё
                </button>
              </div>
            )}
          </div>
        )}
      </main>
      
      <style>{`
        @keyframes fade-in {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .animate-fade-in {
          animation: fade-in 0.3s ease-out forwards;
        }
        .animate-fade-in-down {
          animation: fade-in 0.3s ease-out forwards reverse;
        }
      `}</style>
    </div>
  );
}
