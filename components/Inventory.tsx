import React, { useState, useEffect, useRef, useCallback } from 'react';
import { InventoryItem, ShoppingListItem } from '../types';
import { getInventory, addInventoryItems, addInventoryItem, removeInventoryItem, getShoppingList, addShoppingListItems, removeShoppingListItem } from '../services/dbService';
import { parseGroceryListFromText, parseGroceryListFromImage } from '../services/geminiService';

interface InventoryProps {
  userId: string;
}

type Tab = 'inventory' | 'shopping';

const Inventory: React.FC<InventoryProps> = ({ userId }) => {
  const [activeTab, setActiveTab] = useState<Tab>('inventory');
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [shoppingList, setShoppingList] = useState<ShoppingListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [shoppingListLoading, setShoppingListLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [chatInput, setChatInput] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef<SpeechRecognition | null>(null);

  const loadInventory = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const list = await getInventory(userId);
      setItems(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load inventory.');
    } finally {
      setLoading(false);
    }
  }, [userId]);

  const loadShoppingList = useCallback(async () => {
    setShoppingListLoading(true);
    try {
      const list = await getShoppingList(userId);
      setShoppingList(list);
    } catch {
      setShoppingList([]);
    } finally {
      setShoppingListLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    loadInventory();
  }, [loadInventory]);

  useEffect(() => {
    loadShoppingList();
  }, [loadShoppingList]);

  const addParsedItems = useCallback(
    async (parsed: { name: string; quantity?: string }[]) => {
      if (parsed.length === 0) return;
      setIsProcessing(true);
      setError(null);
      try {
        const added = await addInventoryItems(
          userId,
          parsed.map((p) => ({ name: p.name.trim(), quantity: p.quantity?.trim() || undefined }))
        );
        setItems((prev) => [...added, ...prev]);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to add items.');
      } finally {
        setIsProcessing(false);
      }
    },
    [userId]
  );

  const addParsedItemsToShoppingList = useCallback(
    async (parsed: { name: string; quantity?: string }[]) => {
      if (parsed.length === 0) return;
      setIsProcessing(true);
      setError(null);
      try {
        const added = await addShoppingListItems(
          userId,
          parsed.map((p) => ({ name: p.name.trim(), quantity: p.quantity?.trim() || undefined }))
        );
        setShoppingList((prev) => [...added, ...prev]);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to add to shopping list.');
      } finally {
        setIsProcessing(false);
      }
    },
    [userId]
  );

  const handlePhotoAdd = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>, target: 'inventory' | 'shopping') => {
      const file = e.target.files?.[0];
      if (!file || !file.type.startsWith('image/')) return;
      e.target.value = '';
      setIsProcessing(true);
      setError(null);
      try {
        const base64 = await new Promise<string>((res, rej) => {
          const reader = new FileReader();
          reader.onload = () => {
            const dataUrl = reader.result as string;
            res(dataUrl.split(',')[1] ?? '');
          };
          reader.onerror = rej;
          reader.readAsDataURL(file);
        });
        const parsed = await parseGroceryListFromImage(base64);
        if (target === 'shopping') await addParsedItemsToShoppingList(parsed);
        else await addParsedItems(parsed);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to read photo.');
      } finally {
        setIsProcessing(false);
      }
    },
    [addParsedItems, addParsedItemsToShoppingList]
  );

  const handleChatSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const text = chatInput.trim();
      if (!text) return;
      setChatInput('');
      const target = activeTab;
      setIsProcessing(true);
      setError(null);
      try {
        const parsed = await parseGroceryListFromText(text);
        if (target === 'shopping') await addParsedItemsToShoppingList(parsed);
        else await addParsedItems(parsed);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to add from text.');
      } finally {
        setIsProcessing(false);
      }
    },
    [chatInput, activeTab, addParsedItems, addParsedItemsToShoppingList]
  );

  const handleVoiceToggle = useCallback((target: 'inventory' | 'shopping') => {
    const SpeechRecognitionAPI = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognitionAPI) {
      setError('Voice input is not supported in this browser.');
      return;
    }
    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
      return;
    }
    const recognition = new SpeechRecognitionAPI();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = 'en-US';
    recognition.onresult = (event: SpeechRecognitionEvent) => {
      const transcript = event.results[0]?.[0]?.transcript ?? '';
      if (transcript.trim()) {
        const add = target === 'shopping' ? addParsedItemsToShoppingList : addParsedItems;
        parseGroceryListFromText(transcript).then((parsed) => add(parsed));
      }
    };
    recognition.onend = () => setIsListening(false);
    recognition.onerror = () => setError('Voice recognition failed.');
    recognitionRef.current = recognition;
    recognition.start();
    setIsListening(true);
  }, [isListening, addParsedItems, addParsedItemsToShoppingList]);

  const handleRemove = useCallback(
    async (itemId: string) => {
      try {
        await removeInventoryItem(userId, itemId);
        setItems((prev) => prev.filter((i) => i.id !== itemId));
      } catch {
        setError('Failed to remove item.');
      }
    },
    [userId]
  );

  const handleRemoveShoppingItem = useCallback(
    async (itemId: string) => {
      try {
        await removeShoppingListItem(userId, itemId);
        setShoppingList((prev) => prev.filter((i) => i.id !== itemId));
      } catch {
        setError('Failed to remove item.');
      }
    },
    [userId]
  );

  const handleMoveToInventory = useCallback(
    async (item: ShoppingListItem) => {
      try {
        await addInventoryItem(userId, { name: item.name, quantity: item.quantity });
        await removeShoppingListItem(userId, item.id);
        setShoppingList((prev) => prev.filter((i) => i.id !== item.id));
        loadInventory();
      } catch {
        setError('Failed to move to inventory.');
      }
    },
    [userId, loadInventory]
  );

  const handleMoveAllToInventory = useCallback(async () => {
    if (shoppingList.length === 0) return;
    setIsProcessing(true);
    setError(null);
    try {
      await addInventoryItems(
        userId,
        shoppingList.map((i) => ({ name: i.name, quantity: i.quantity }))
      );
      for (const item of shoppingList) {
        await removeShoppingListItem(userId, item.id);
      }
      setShoppingList([]);
      loadInventory();
    } catch {
      setError('Failed to move all to inventory.');
    } finally {
      setIsProcessing(false);
    }
  }, [userId, shoppingList, loadInventory]);

  return (
    <div className="min-h-screen bg-[#faf8f5] pb-24">
      <header className="px-6 pt-8 pb-4">
        <h1 className="text-2xl font-semibold text-stone-900 tracking-tight">Grocery</h1>
        <p className="text-stone-500 text-sm mt-1">Inventory and shopping list from recipes.</p>
        <div className="flex gap-2 mt-4">
          <button
            type="button"
            onClick={() => setActiveTab('inventory')}
            className={`flex-1 py-2.5 rounded-xl text-sm font-medium transition-colors ${activeTab === 'inventory' ? 'bg-stone-900 text-white' : 'bg-stone-100 text-stone-600'}`}
          >
            Inventory
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('shopping')}
            className={`flex-1 py-2.5 rounded-xl text-sm font-medium transition-colors ${activeTab === 'shopping' ? 'bg-stone-900 text-white' : 'bg-stone-100 text-stone-600'}`}
          >
            Shopping list
          </button>
        </div>
        <p className="hidden" aria-hidden="true"> We’ll save them here.</p>
      </header>

      <div className="px-6 space-y-4">
        {error && (
          <div className="p-3 rounded-xl bg-red-50 border border-red-100 text-red-700 text-sm flex items-center justify-between gap-2">
            <span>{error}</span>
            <button type="button" onClick={() => setError(null)} className="text-red-600 font-medium text-xs">
              Dismiss
            </button>
          </div>
        )}

        {activeTab === 'shopping' && (
          <>
          <div className="bg-white rounded-2xl border border-stone-200 shadow-sm overflow-hidden">
            <p className="text-xs font-semibold text-stone-400 uppercase tracking-wider px-4 py-3 border-b border-stone-100">
              Add items
            </p>
            <div className="p-4 space-y-3">
              <div className="flex gap-2">
                <label className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-stone-100 text-stone-700 font-medium text-sm cursor-pointer hover:bg-stone-200 active:scale-[0.99] transition-all">
                  <input type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => handlePhotoAdd(e, 'shopping')} disabled={isProcessing} />
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                  Photo
                </label>
                <button
                  type="button"
                  onClick={() => handleVoiceToggle('shopping')}
                  disabled={isProcessing}
                  className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-medium text-sm transition-all active:scale-[0.99] ${
                    isListening ? 'bg-red-500 text-white' : 'bg-stone-100 text-stone-700 hover:bg-stone-200'
                  }`}
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" /></svg>
                  {isListening ? 'Listening…' : 'Voice'}
                </button>
              </div>
              <p className="text-xs text-stone-500">Write your complete ingredients list with quantity. We'll infer units (e.g. milk 100 → 100ml, eggs 2 → 2).</p>
              <form onSubmit={handleChatSubmit} className="flex gap-2">
                <input
                  type="text"
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  placeholder="e.g. milk 100, eggs 2, flour 500, olive oil 1"
                  className="flex-1 bg-stone-100 rounded-xl py-2.5 px-4 text-sm placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                  disabled={isProcessing}
                />
                <button
                  type="submit"
                  disabled={isProcessing || !chatInput.trim()}
                  className="px-4 py-2.5 rounded-xl bg-emerald-600 text-white font-medium text-sm disabled:opacity-50 active:scale-[0.98]"
                >
                  Add
                </button>
              </form>
            </div>
          </div>
          {activeTab === 'shopping' && isProcessing && (
            <div className="flex items-center justify-center gap-2 py-2 text-stone-500 text-sm">
              <div className="w-4 h-4 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
              <span>Adding items…</span>
            </div>
          )}
          <div className="bg-white rounded-2xl border border-stone-200 shadow-sm overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-stone-100">
              <p className="text-xs font-semibold text-stone-400 uppercase tracking-wider">
                Shopping list
              </p>
              {shoppingList.length > 0 && (
                <button
                  type="button"
                  onClick={handleMoveAllToInventory}
                  disabled={isProcessing}
                  className="text-xs font-medium text-emerald-600 hover:text-emerald-700 disabled:opacity-50"
                >
                  Move all to inventory
                </button>
              )}
            </div>
            {shoppingListLoading ? (
              <div className="p-8 flex justify-center">
                <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
              </div>
            ) : shoppingList.length === 0 ? (
              <p className="p-6 text-stone-500 text-sm text-center">No items. Add missing ingredients from a recipe.</p>
            ) : (
              <ul className="divide-y divide-stone-100">
                {shoppingList.map((item) => (
                  <li key={item.id} className="px-4 py-3 flex items-center justify-between gap-3">
                    <div>
                      <span className="font-medium text-stone-800">{item.name}</span>
                      {item.quantity && <span className="text-stone-500 text-sm ml-2">({item.quantity})</span>}
                      {item.sourceRecipeTitle && (
                        <p className="text-stone-400 text-xs mt-0.5">From: {item.sourceRecipeTitle}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => handleMoveToInventory(item)}
                        className="p-2 rounded-lg text-stone-400 hover:bg-emerald-50 hover:text-emerald-600 transition-colors"
                        aria-label={`Move ${item.name} to inventory`}
                        title="Move to inventory"
                      >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" /></svg>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleRemoveShoppingItem(item.id)}
                        className="p-2 rounded-lg text-stone-400 hover:bg-red-50 hover:text-red-600 transition-colors"
                        aria-label={`Remove ${item.name}`}
                      >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
          </>
        )}

        {activeTab === 'inventory' && (
        <>
        <div className="bg-white rounded-2xl border border-stone-200 shadow-sm overflow-hidden">
          <p className="text-xs font-semibold text-stone-400 uppercase tracking-wider px-4 py-3 border-b border-stone-100">
            Add items
          </p>
          <div className="p-4 space-y-3">
            <div className="flex gap-2">
              <label className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-stone-100 text-stone-700 font-medium text-sm cursor-pointer hover:bg-stone-200 active:scale-[0.99] transition-all">
                <input type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => handlePhotoAdd(e, 'inventory')} disabled={isProcessing} />
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                Photo
              </label>
              <button
                type="button"
                onClick={() => handleVoiceToggle('inventory')}
                disabled={isProcessing}
                className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-medium text-sm transition-all active:scale-[0.99] ${
                  isListening ? 'bg-red-500 text-white' : 'bg-stone-100 text-stone-700 hover:bg-stone-200'
                }`}
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" /></svg>
                {isListening ? 'Listening…' : 'Voice'}
              </button>
            </div>
            <p className="text-xs text-stone-500">Write your complete ingredients list with quantity. We’ll infer units (e.g. milk 100 → 100ml, eggs 2 → 2).</p>
            <form onSubmit={handleChatSubmit} className="flex gap-2">
              <input
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder="e.g. milk 100, eggs 2, flour 500, olive oil 1"
                className="flex-1 bg-stone-100 rounded-xl py-2.5 px-4 text-sm placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                disabled={isProcessing}
              />
              <button
                type="submit"
                disabled={isProcessing || !chatInput.trim()}
                className="px-4 py-2.5 rounded-xl bg-emerald-600 text-white font-medium text-sm disabled:opacity-50 active:scale-[0.98]"
              >
                Add
              </button>
            </form>
          </div>
        </div>

        {activeTab === 'inventory' && isProcessing && (
          <div className="flex items-center justify-center gap-2 py-2 text-stone-500 text-sm">
            <div className="w-4 h-4 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
            <span>Adding items…</span>
          </div>
        )}

        <div className="bg-white rounded-2xl border border-stone-200 shadow-sm overflow-hidden">
          <p className="text-xs font-semibold text-stone-400 uppercase tracking-wider px-4 py-3 border-b border-stone-100">
            Your list
          </p>
          {loading ? (
            <div className="p-8 flex justify-center">
              <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : items.length === 0 ? (
            <p className="p-6 text-stone-500 text-sm text-center">No items yet. Add some with photo, chat, or voice.</p>
          ) : (
            <ul className="divide-y divide-stone-100">
              {items.map((item) => (
                <li key={item.id} className="px-4 py-3 flex items-center justify-between gap-3">
                  <div>
                    <span className="font-medium text-stone-800">{item.name}</span>
                    {item.quantity && <span className="text-stone-500 text-sm ml-2">({item.quantity})</span>}
                  </div>
                  <button
                    type="button"
                    onClick={() => handleRemove(item.id)}
                    className="p-2 rounded-lg text-stone-400 hover:bg-red-50 hover:text-red-600 transition-colors"
                    aria-label={`Remove ${item.name}`}
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        </>
        )}
      </div>
    </div>
  );
};

export default Inventory;
