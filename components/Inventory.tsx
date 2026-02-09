import React, { useState, useEffect, useRef, useCallback } from 'react';
import { InventoryItem, ShoppingListItem } from '../types';
import { getInventory, addInventoryItems, addInventoryItem, removeInventoryItem, getShoppingList, addShoppingListItems, removeShoppingListItem } from '../services/dbService';
import { parseGroceryListFromText, parseGroceryListFromImage } from '../services/geminiService';

interface InventoryProps {
  userId: string;
  /** When set, open on this tab (e.g. 'shopping' when coming from "Want to see shopping list? Yes"). */
  initialTab?: 'inventory' | 'shopping';
}

type Tab = 'inventory' | 'shopping';

const Inventory: React.FC<InventoryProps> = ({ userId, initialTab }) => {
  const [activeTab, setActiveTab] = useState<Tab>(initialTab ?? 'inventory');
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [shoppingList, setShoppingList] = useState<ShoppingListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [shoppingListLoading, setShoppingListLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [chatInput, setChatInput] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [selectedInventoryIds, setSelectedInventoryIds] = useState<Set<string>>(new Set());
  const [selectedShoppingIds, setSelectedShoppingIds] = useState<Set<string>>(new Set());
  const recognitionRef = useRef<SpeechRecognition | null>(null);

  const clearSelectionOnTabChange = useCallback((tab: Tab) => {
    setActiveTab(tab);
    setSelectedInventoryIds(new Set());
    setSelectedShoppingIds(new Set());
  }, []);

  const loadInventory = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const list = await getInventory(userId);
      setItems(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : "We couldn't load your pantry. Try again?");
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
        setItems((prev) => {
          const updatedIds = new Set(added.map((a) => a.id));
          const rest = prev.filter((i) => !updatedIds.has(i.id));
          return [...added, ...rest];
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't add those. Try again?");
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
        await addShoppingListItems(
          userId,
          parsed.map((p) => ({ name: p.name.trim(), quantity: p.quantity?.trim() || undefined }))
        );
        const list = await getShoppingList(userId);
        setShoppingList(list);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't add to your list. Try again?");
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
        setError(err instanceof Error ? err.message : "We couldn't read that photo. Try another?");
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
        setError(err instanceof Error ? err.message : "Couldn't add from that text. Try again?");
      } finally {
        setIsProcessing(false);
      }
    },
    [chatInput, activeTab, addParsedItems, addParsedItemsToShoppingList]
  );

  const handleVoiceToggle = useCallback(() => {
    const SpeechRecognitionAPI = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognitionAPI) {
      setError("Voice isn't supported here. Type or use a photo instead!");
      return;
    }
    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
      return;
    }
    const recognition = new SpeechRecognitionAPI();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';
    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let interim = '';
      let final = '';
      for (let i = 0; i < event.results.length; i++) {
        const result = event.results[i];
        const text = result[0]?.transcript ?? '';
        if (result.isFinal) {
          final += text;
        } else {
          interim += text;
        }
      }
      // Show final + interim in the text input as the user speaks
      setChatInput((final + interim).trim());
    };
    recognition.onend = () => setIsListening(false);
    recognition.onerror = () => {
      setError("We didn't catch that. Try again?");
      setIsListening(false);
    };
    recognitionRef.current = recognition;
    recognition.start();
    setIsListening(true);
    setError(null);
  }, [isListening]);

  const handleRemove = useCallback(
    async (itemId: string) => {
      try {
        await removeInventoryItem(userId, itemId);
        setItems((prev) => prev.filter((i) => i.id !== itemId));
      } catch {
        setError("Couldn't remove that. Try again?");
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
        setError("Couldn't remove that. Try again?");
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
        setError("Couldn't move that. Try again?");
      }
    },
    [userId, loadInventory]
  );

  const handleMoveSelectedToInventory = useCallback(async () => {
    const selected = shoppingList.filter((i) => selectedShoppingIds.has(i.id));
    if (selected.length === 0) return;
    setIsProcessing(true);
    setError(null);
    try {
      await addInventoryItems(
        userId,
        selected.map((i) => ({ name: i.name, quantity: i.quantity }))
      );
      for (const item of selected) {
        await removeShoppingListItem(userId, item.id);
      }
      setShoppingList((prev) => prev.filter((i) => !selectedShoppingIds.has(i.id)));
      setSelectedShoppingIds(new Set());
      loadInventory();
    } catch {
      setError("Couldn't move those. Try again?");
    } finally {
      setIsProcessing(false);
    }
  }, [userId, shoppingList, selectedShoppingIds, loadInventory]);

  const toggleInventorySelection = useCallback((id: string) => {
    setSelectedInventoryIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleShoppingSelection = useCallback((id: string) => {
    setSelectedShoppingIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectAllInventory = useCallback(() => {
    setSelectedInventoryIds(new Set(items.map((i) => i.id)));
  }, [items]);

  const selectAllShopping = useCallback(() => {
    setSelectedShoppingIds(new Set(shoppingList.map((i) => i.id)));
  }, [shoppingList]);

  const deselectAllInventory = useCallback(() => {
    setSelectedInventoryIds(new Set());
  }, []);

  const deselectAllShopping = useCallback(() => {
    setSelectedShoppingIds(new Set());
  }, []);

  const handleDeleteSelectedInventory = useCallback(async () => {
    const ids: string[] = Array.from(selectedInventoryIds);
    if (ids.length === 0) return;
    setIsProcessing(true);
    setError(null);
    try {
      for (const id of ids) {
        await removeInventoryItem(userId, id);
      }
      setItems((prev) => prev.filter((i) => !selectedInventoryIds.has(i.id)));
      setSelectedInventoryIds(new Set());
    } catch {
      setError("Couldn't delete those. Try again?");
    } finally {
      setIsProcessing(false);
    }
  }, [userId, selectedInventoryIds]);

  const handleDeleteSelectedShopping = useCallback(async () => {
    const ids: string[] = Array.from(selectedShoppingIds);
    if (ids.length === 0) return;
    setIsProcessing(true);
    setError(null);
    try {
      for (const id of ids) {
        await removeShoppingListItem(userId, id);
      }
      setShoppingList((prev) => prev.filter((i) => !selectedShoppingIds.has(i.id)));
      setSelectedShoppingIds(new Set());
    } catch {
      setError("Couldn't delete those. Try again?");
    } finally {
      setIsProcessing(false);
    }
  }, [userId, selectedShoppingIds]);

  return (
    <div className="min-h-screen bg-[#faf8f5] pb-24">
      <header className="px-6 pt-8 pb-4">
        <h1 className="text-2xl font-semibold text-stone-900 tracking-tight">Grocery</h1>
        <p className="text-stone-500 text-sm mt-1">Inventory and shopping list from recipes.</p>
        <div className="flex gap-2 mt-4">
          <button
            type="button"
            onClick={() => clearSelectionOnTabChange('inventory')}
            className={`flex-1 py-2.5 rounded-xl text-sm font-medium transition-colors ${activeTab === 'inventory' ? 'bg-stone-900 text-white' : 'bg-stone-100 text-stone-600'}`}
          >
            Inventory
          </button>
          <button
            type="button"
            onClick={() => clearSelectionOnTabChange('shopping')}
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
                  onClick={handleVoiceToggle}
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
            <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-stone-100 flex-wrap">
              <p className="text-xs font-semibold text-stone-400 uppercase tracking-wider">
                Shopping list
              </p>
              {shoppingList.length > 0 && (
                <div className="flex items-center gap-3 flex-wrap">
                  <button
                    type="button"
                    onClick={handleMoveSelectedToInventory}
                    disabled={isProcessing || selectedShoppingIds.size === 0}
                    className="text-xs font-medium text-emerald-600 hover:text-emerald-700 disabled:text-stone-400 disabled:cursor-not-allowed disabled:hover:text-stone-400"
                  >
                    Add to inventory ({selectedShoppingIds.size})
                  </button>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={shoppingList.length > 0 && selectedShoppingIds.size === shoppingList.length}
                      onChange={(e) => (e.target.checked ? selectAllShopping() : deselectAllShopping())}
                      className="rounded border-stone-300 text-emerald-600 focus:ring-emerald-500"
                    />
                    <span className="text-xs font-medium text-stone-600">Select all</span>
                  </label>
                  <button
                    type="button"
                    onClick={handleDeleteSelectedShopping}
                    disabled={isProcessing || selectedShoppingIds.size === 0}
                    className="text-xs font-medium text-red-600 hover:text-red-700 disabled:text-stone-400 disabled:cursor-not-allowed disabled:hover:text-stone-400 flex items-center gap-1"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                    Delete ({selectedShoppingIds.size})
                  </button>
                </div>
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
                  <li
                    key={item.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => toggleShoppingSelection(item.id)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleShoppingSelection(item.id); } }}
                    className={`px-4 py-3 flex items-center gap-3 cursor-pointer select-none ${selectedShoppingIds.has(item.id) ? 'bg-emerald-50/60' : ''} hover:bg-stone-50/80`}
                    aria-pressed={selectedShoppingIds.has(item.id)}
                  >
                    <input
                      type="checkbox"
                      checked={selectedShoppingIds.has(item.id)}
                      onChange={() => toggleShoppingSelection(item.id)}
                      onClick={(e) => e.stopPropagation()}
                      className="rounded border-stone-300 text-emerald-600 focus:ring-emerald-500 shrink-0"
                      aria-label={`Select ${item.name}`}
                    />
                    <div className="flex-1 min-w-0 pointer-events-none">
                      <span className="font-medium text-stone-800">{item.name}</span>
                      {item.quantity && <span className="text-stone-500 text-sm ml-2">({item.quantity})</span>}
                      {item.sourceRecipeTitle && (
                        <p className="text-stone-400 text-xs mt-0.5">From: {item.sourceRecipeTitle}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
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
                onClick={handleVoiceToggle}
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
          <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-stone-100">
            <p className="text-xs font-semibold text-stone-400 uppercase tracking-wider">
              Your list
            </p>
            {items.length > 0 && (
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={items.length > 0 && selectedInventoryIds.size === items.length}
                    onChange={(e) => (e.target.checked ? selectAllInventory() : deselectAllInventory())}
                    className="rounded border-stone-300 text-emerald-600 focus:ring-emerald-500"
                  />
                  <span className="text-xs font-medium text-stone-600">Select all</span>
                </label>
                <button
                  type="button"
                  onClick={handleDeleteSelectedInventory}
                  disabled={isProcessing || selectedInventoryIds.size === 0}
                  className="text-xs font-medium text-red-600 hover:text-red-700 disabled:text-stone-400 disabled:cursor-not-allowed disabled:hover:text-stone-400 flex items-center gap-1"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                  Delete ({selectedInventoryIds.size})
                </button>
              </div>
            )}
          </div>
          {loading ? (
            <div className="p-8 flex justify-center">
              <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : items.length === 0 ? (
            <p className="p-6 text-stone-500 text-sm text-center">No items yet. Add some with photo, chat, or voice.</p>
          ) : (
            <ul className="divide-y divide-stone-100">
              {items.map((item) => (
                <li
                  key={item.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => toggleInventorySelection(item.id)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleInventorySelection(item.id); } }}
                  className={`px-4 py-3 flex items-center gap-3 cursor-pointer select-none ${selectedInventoryIds.has(item.id) ? 'bg-emerald-50/60' : ''} hover:bg-stone-50/80`}
                  aria-pressed={selectedInventoryIds.has(item.id)}
                >
                  <input
                    type="checkbox"
                    checked={selectedInventoryIds.has(item.id)}
                    onChange={() => toggleInventorySelection(item.id)}
                    onClick={(e) => e.stopPropagation()}
                    className="rounded border-stone-300 text-emerald-600 focus:ring-emerald-500 shrink-0"
                    aria-label={`Select ${item.name}`}
                  />
                  <div className="flex-1 min-w-0 pointer-events-none">
                    <span className="font-medium text-stone-800">{item.name}</span>
                    {item.quantity && <span className="text-stone-500 text-sm ml-2">({item.quantity})</span>}
                  </div>
                  <span onClick={(e) => e.stopPropagation()}>
                  <button
                    type="button"
                    onClick={() => handleRemove(item.id)}
                    className="p-2 rounded-lg text-stone-400 hover:bg-red-50 hover:text-red-600 transition-colors shrink-0"
                    aria-label={`Remove ${item.name}`}
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                  </button>
                  </span>
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
