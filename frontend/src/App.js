import React, { useState, useEffect, useRef, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';

// --- Configuration ---
// Base URLs for APIs ---------------------------------------------------------
// If you set environment variables `REACT_APP_OLLAMA_API_URL` or
// `REACT_APP_STATS_API_URL` these values will be used. Otherwise we fall back
// to using the hostname of the page the user is currently visiting. This makes
// the app work whether it is accessed locally on the Jetson itself or from a
// computer on the same network.

function buildApiUrl(envVar, defaultPort) {
  const env = process.env[envVar];
  if (env && env.trim() !== '') return env;
  const { protocol, hostname } = window.location;
  return `${protocol}//${hostname}:${defaultPort}`;
}

const OLLAMA_API_BASE_URL = buildApiUrl('REACT_APP_OLLAMA_API_URL', 11434);
const STATS_API_BASE_URL  = buildApiUrl('REACT_APP_STATS_API_URL', 5001);

// --- Helper Components ---

// A sleek gauge component to display system resource usage
const ResourceGauge = ({ label, value, max, unit, color }) => {
  const percentage = max > 0 ? (value / max) * 100 : 0;
  const circumference = 2 * Math.PI * 45; // 45 is the radius
  const strokeDashoffset = circumference - (percentage / 100) * circumference;

  return (
    <div className="flex flex-col items-center justify-center bg-gray-800/50 p-4 rounded-2xl shadow-lg border border-gray-700/50">
      <div className="relative w-28 h-28">
        <svg className="w-full h-full" viewBox="0 0 100 100">
          {/* Background circle */}
          <circle
            className="text-gray-700"
            strokeWidth="10"
            stroke="currentColor"
            fill="transparent"
            r="45"
            cx="50"
            cy="50"
          />
          {/* Progress circle */}
          <circle
            className={`transform -rotate-90 origin-center`}
            style={{ color }}
            strokeWidth="10"
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            strokeLinecap="round"
            stroke="currentColor"
            fill="transparent"
            r="45"
            cx="50"
            cy="50"
          />
        </svg>
        <div className="absolute top-0 left-0 w-full h-full flex flex-col items-center justify-center">
          <span className="text-xl font-bold text-white">{`${Math.round(value)}${unit}`}</span>
          {max > 0 && <span className="text-xs text-gray-400">{`/ ${max}${unit}`}</span>}
        </div>
      </div>
      <span className="mt-2 text-sm font-medium text-gray-300">{label}</span>
    </div>
  );
};

// Component for displaying chat messages
const ChatMessage = ({ message }) => {
    const isUser = message.role === 'user';
    return (
        <div className={`flex items-start gap-3 my-4 ${isUser ? 'justify-end' : 'justify-start'}`}>
             {!isUser && (
                <div className="w-10 h-10 bg-gradient-to-br from-green-500 to-teal-500 rounded-full flex-shrink-0 flex items-center justify-center shadow-md">
                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 8V4H8"/><rect x="4" y="12" width="16" height="8" rx="2"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="M17 12v-2a2 2 0 0 0-2-2h-2a2 2 0 0 0-2 2v2"/></svg>
                </div>
            )}
            <div className={`p-4 rounded-2xl markdown-body max-w-lg ${isUser ? 'bg-blue-600/80 text-white rounded-br-none' : 'bg-gray-700/70 text-gray-200 rounded-bl-none'}`}>
                 {message.content.trim() === '' && message.role === 'assistant' ? (
                    <span className="italic text-gray-400 animate-pulse">Thinking…</span>
                 ) : (
                 <ReactMarkdown
                    remarkPlugins={[remarkGfm, remarkBreaks]}
                    components={{
                      a: ({node, ...props}) => <a className="text-blue-400 underline" {...props} />,
                      code({node, inline, className, children, ...props}) {
                        const match = /language-(\w+)/.exec(className || '');
                        const content = String(children).replace(/\n$/, '');
                        if (inline) {
                          return (
                            <code className="bg-gray-800/70 text-red-300 px-1 py-0.5 rounded" {...props}>{content}</code>
                          );
                        }
                        return (
                          <pre className="bg-gray-900 rounded-lg p-4 overflow-x-auto text-sm" {...props}>
                            <code className="text-gray-100 whitespace-pre-wrap">{content}</code>
                          </pre>
                        );
                      }
                    }}
                    className="prose prose-invert text-sm"
                 >
                     {message.content}
                 </ReactMarkdown>
                 )}
            </div>
             {isUser && (
                <div className="w-10 h-10 bg-gradient-to-br from-indigo-500 to-purple-500 rounded-full flex-shrink-0 flex items-center justify-center shadow-md">
                     <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                </div>
            )}
        </div>
    );
};

// Main App Component
export default function App() {
  // State Management
  const [systemStats, setSystemStats] = useState(null);
  const [statsError, setStatsError] = useState(null);
  const [models, setModels] = useState([]);
  const [selectedModel, setSelectedModel] = useState('');
  const [selectedModelInfo, setSelectedModelInfo] = useState(null);
  const [chatHistory, setChatHistory] = useState([]);
  const [prompt, setPrompt] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [pullModelName, setPullModelName] = useState('gemma:2b');
  const [pullStatus, setPullStatus] = useState('');
  const chatEndRef = useRef(null);

  // toggle visibility of left panels
  const [showResources, setShowResources] = useState(true);
  const [showModelMgmt, setShowModelMgmt] = useState(true);
  // NEW: visibility state for Saved Chats panel
  const [showSavedChats, setShowSavedChats] = useState(true);

  // NEW: saved chats state
  const [savedChats, setSavedChats] = useState([]);

  // --- API Functions ---

  // Fetch system stats from our Python helper
  const fetchStats = useCallback(async () => {
    try {
      const response = await fetch(`${STATS_API_BASE_URL}/api/system-stats`);
      if (!response.ok) {
        throw new Error(`Stats server responded with status: ${response.status}`);
      }
      const data = await response.json();
      setSystemStats(data);
      if (statsError) setStatsError(null);
    } catch (error) {
      console.error("Failed to fetch system stats:", error);
      setStatsError('Could not connect to stats helper. Is it running?');
    }
  }, [statsError]);


  // Fetch list of locally available Ollama models
  const fetchModels = useCallback(async () => {
    try {
      const response = await fetch(`${OLLAMA_API_BASE_URL}/api/tags`);
      const data = await response.json();
      setModels(data.models);
      // Automatically select the first model if none is selected
      if (!selectedModel && data.models.length > 0) {
        setSelectedModel(data.models[0].name);
        setSelectedModelInfo(data.models[0]);
      }
    } catch (error) {
      console.error("Failed to fetch Ollama models:", error);
    }
  }, [selectedModel]);
  
  // --- Effects ---

  // Initial data fetch and interval for stats
  useEffect(() => {
    fetchModels();
    fetchStats();
    const interval = setInterval(fetchStats, 500); // Refresh stats ~2× per second
    return () => clearInterval(interval);
  }, [fetchModels, fetchStats]);

  // Scroll to the bottom of the chat on new message
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatHistory]);

  // Load saved chats on mount
  useEffect(() => {
    const saved = localStorage.getItem('savedChats_v1');
    if (saved) {
      try { setSavedChats(JSON.parse(saved)); } catch (_) {}
    }
  }, []);

  // Persist saved chats whenever they change
  useEffect(() => {
    localStorage.setItem('savedChats_v1', JSON.stringify(savedChats));
  }, [savedChats]);

  // --- Handlers ---
  const handlePullModel = async (e) => {
    e.preventDefault();
    if (!pullModelName) return;
    setIsStreaming(true);
    setPullStatus(`Pulling model: ${pullModelName}...`);
    try {
        const response = await fetch(`${OLLAMA_API_BASE_URL}/api/pull`, {
            method: 'POST',
            body: JSON.stringify({ name: pullModelName, stream: true }),
        });

        const reader = response.body.getReader();
        const decoder = new TextDecoder();

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const chunk = decoder.decode(value);
            // In a real app, you'd parse each line of the chunk for detailed status
            const lines = chunk.split('\n').filter(line => line.trim() !== '');
            lines.forEach(line => {
                const json = JSON.parse(line);
                if (json.total && json.completed) {
                    const percent = Math.round((json.completed / json.total) * 100);
                    setPullStatus(`Downloading... ${percent}%`);
                } else if(json.status) {
                    setPullStatus(json.status);
                }
            });
        }
        setPullStatus('Model pulled successfully!');
        fetchModels(); // Refresh model list
    } catch (error) {
        console.error("Failed to pull model:", error);
        setPullStatus('Error pulling model.');
    } finally {
        setIsStreaming(false);
        setTimeout(() => setPullStatus(''), 3000); // Clear status after a while
    }
};


  const handleChatSubmit = async (e) => {
    e.preventDefault();
    if (!prompt || isStreaming || !selectedModel || !selectedModelInfo) return;

    const newUserMessage = { role: 'user', content: prompt };
    const newChatHistory = [...chatHistory, newUserMessage];
    setChatHistory(newChatHistory);
    setPrompt('');
    setIsStreaming(true);

    try {
      const response = await fetch(`${OLLAMA_API_BASE_URL}/api/chat`, {
        method: 'POST',
        body: JSON.stringify({
          model: selectedModel,
          messages: newChatHistory,
          stream: true,
        }),
      });

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let assistantMessage = { role: 'assistant', content: '' };
      let assistantContent = '';
      setChatHistory(prev => [...prev, assistantMessage]);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');
        let hasDelta = false;
        lines.forEach(line => {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('{')) return;
          try {
            const parsed = JSON.parse(trimmed);
            if (parsed.message && parsed.message.content) {
              assistantContent += parsed.message.content;
              hasDelta = true;
            }
          } catch (_) {/* ignore malformed */}
        });

        // Push update once per chunk, not per token
        if (hasDelta) {
          setChatHistory(prevHistory => {
            const updated = [...prevHistory];
            updated[updated.length - 1] = { ...updated[updated.length - 1], content: assistantContent };
            return updated;
          });
        }
      }
    } catch (error) {
      console.error("Chat error:", error);
       setChatHistory(prev => [...prev, {role: 'assistant', content: 'Sorry, I encountered an error.'}]);
    } finally {
      setIsStreaming(false);
    }
  };
  
  const handleClearChat = () => {
    setChatHistory([]);
  }

  // NEW: save current chat
  const handleSaveCurrentChat = () => {
    if (chatHistory.length === 0) return;
    const title = window.prompt('Enter a title for this chat:', `Chat ${new Date().toLocaleString()}`);
    if (!title) return;
    const entry = {
      id: Date.now().toString(),
      title: title.trim(),
      history: chatHistory,
      model: selectedModel,
      created: Date.now()
    };
    setSavedChats(prev => [entry, ...prev]);
  };

  // NEW: load a saved chat
  const handleLoadChat = (id) => {
    const entry = savedChats.find(c => c.id === id);
    if (!entry) return;
    setChatHistory(entry.history);
    if (entry.model) {
      const mInfo = models.find(m => m.name === entry.model);
      setSelectedModel(entry.model);
      setSelectedModelInfo(mInfo || null);
    }
  };

  // NEW: delete saved chat
  const handleDeleteSavedChat = (id) => {
    if (!window.confirm('Delete this saved chat?')) return;
    setSavedChats(prev => prev.filter(c => c.id !== id));
  };

  // Helper: whether we have enough free RAM to load / run the model.
  const hasSufficientMemory = () => {
    if (!systemStats || !selectedModelInfo) return true; // no stats yet
    const freeGb = (systemStats.ram_total_gb || 0) - (systemStats.ram_used_gb || 0);
    const modelGb = (selectedModelInfo.size || 0) / 1e9;
    // require 1.5× model size free (heuristic)
    return freeGb > modelGb * 1.5;
  };

  const memOk = hasSufficientMemory();

  const handleDeleteModel = async (name) => {
    if (!window.confirm(`Delete model '${name}'? This cannot be undone.`)) return;
    try {
      await fetch(`${OLLAMA_API_BASE_URL}/api/delete`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: name })
      });
      // if the deleted model was selected, clear.
      if (selectedModel === name) {
        setSelectedModel('');
        setSelectedModelInfo(null);
      }
      fetchModels();
    } catch (err) {
      alert('Failed to delete model');
      console.error(err);
    }
  };

  return (
    <div className="bg-gray-900 text-white font-sans min-h-screen flex flex-col">
      <header className="bg-gray-900/80 backdrop-blur-sm border-b border-gray-700/50 sticky top-0 z-10">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-3 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <svg className="w-8 h-8 text-green-400" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M14.213 1.001C8.46 1.001 4.088 4.623 3.55 9.773A1.002 1.002 0 0 0 4.548 11h3.918c.27 0 .52-.109.701-.289.182-.182.29-.432.29-.711 0-.551.449-1 1-1s1 .449 1 1c0 .279.108.529.29.711.18.18.43.289.7.289h3.919a1 1 0 0 0 .997-1.227C20.08 4.623 15.71 1 10 1h4.213Z"/><path d="M19.451 13H4.549a1 1 0 0 0-.998 1.227c.537 5.15 4.91 8.773 10.663 8.773h4.213c5.753 0 10.125-3.622 10.663-8.773A1 1 0 0 0 19.452 13Z"/></svg>
            <h1 className="text-xl font-bold text-gray-100">Jetson Ollama Control Panel</h1>
          </div>
          <div className={`w-3 h-3 rounded-full animate-pulse ${statsError ? 'bg-red-500' : 'bg-green-500'}`} title={statsError ? statsError : 'Connected to Stats Helper'}></div>
        </div>
      </header>
      
      <main className="flex-grow container mx-auto p-4 sm:p-6 lg:p-8 grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: System & Model Management */}
        <div className="lg:col-span-1 flex flex-col gap-6">
            <div className="bg-gray-800/60 rounded-2xl border border-gray-700/50 overflow-hidden">
                <button onClick={()=>setShowResources(!showResources)} className="w-full flex justify-between items-center px-5 py-3 bg-gray-800/70 hover:bg-gray-800 text-lg font-semibold text-green-400">
                  <span>System Resources</span>
                  <span>{showResources ? '▾':'▸'}</span>
                </button>
                {showResources && (
                <div className="p-5">
                {statsError ? (
                  <div className="text-center text-red-400 bg-red-900/50 p-4 rounded-lg">{statsError}</div>
                ) : systemStats ? (
                  <div className="grid grid-cols-2 gap-4">
                    <ResourceGauge label="CPU" value={systemStats.cpu_usage_percent || 0} max={100} unit="%" color="#22c55e" />
                    <ResourceGauge label="GPU" value={systemStats.gpu_usage_percent || 0} max={100} unit="%" color="#3b82f6" />
                    <ResourceGauge label="RAM" value={systemStats.ram_used_gb || 0} max={systemStats.ram_total_gb || 0} unit="GB" color="#eab308" />
                    <ResourceGauge label="Temp" value={systemStats.soc_temp_c || 0} max={100} unit="°C" color="#ef4444" />
                  </div>
                ) : (
                  <div className="text-center text-gray-400">Loading stats...</div>
                )}
                </div>
                )}
            </div>

            <div className="bg-gray-800/60 rounded-2xl border border-gray-700/50 overflow-hidden">
                <button onClick={()=>setShowModelMgmt(!showModelMgmt)} className="w-full flex justify-between items-center px-5 py-3 bg-gray-800/70 hover:bg-gray-800 text-lg font-semibold text-blue-400">
                  <span>Model Management</span>
                  <span>{showModelMgmt ? '▾':'▸'}</span>
                </button>
              {showModelMgmt && (
                <div className="p-5">
                <form onSubmit={handlePullModel} className="flex gap-2 mb-4">
                    <input 
                        type="text" 
                        value={pullModelName}
                        onChange={(e) => setPullModelName(e.target.value)}
                        placeholder="e.g., gemma:7b-instruct"
                        className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
                    />
                    <button type="submit" disabled={isStreaming} className="bg-blue-600 hover:bg-blue-700 disabled:bg-blue-800/50 disabled:cursor-not-allowed text-white px-4 py-2 rounded-lg text-sm font-semibold transition-colors">
                        Pull
                    </button>
                </form>
                {pullStatus && <div className="text-sm text-center text-yellow-300 mb-4">{pullStatus}</div>}
                
                <h3 className="text-md font-semibold mb-2 text-gray-300">Available Models</h3>
                <div className="max-h-48 overflow-y-auto pr-2">
                  {models.length > 0 ? (
                    models.map(model => (
                      <div 
                        key={model.name}
                        className={`group p-3 my-1 rounded-lg transition-all duration-200 border-2 flex justify-between items-center ${selectedModel === model.name ? 'bg-blue-600/30 border-blue-500' : 'bg-gray-700/50 border-transparent hover:border-gray-600'}`}
                      >
                        <div className="flex-1 cursor-pointer" onClick={() => {setSelectedModel(model.name); setSelectedModelInfo(model);}}>
                          <p className="font-semibold text-sm">{model.name}</p>
                          <p className="text-xs text-gray-400">{(model.size / 1e9).toFixed(2)} GB</p>
                        </div>
                        <button onClick={() => handleDeleteModel(model.name)} title="Delete model" className="hidden group-hover:block text-red-400 hover:text-red-300">
                          ✕
                        </button>
                      </div>
                    ))
                  ) : (
                    <p className="text-sm text-gray-500">No local models found.</p>
                  )}
                </div>
                {!memOk && (
                  <p className="text-xs text-red-400 mt-1">Not enough free RAM to run this model right now.</p>
                )}
                </div>
              )}
            </div>

            {/* NEW: Saved Chats Panel */}
            <div className="bg-gray-800/60 rounded-2xl border border-gray-700/50 overflow-hidden">
                <button onClick={()=>setShowSavedChats(!showSavedChats)} className="w-full flex justify-between items-center px-5 py-3 bg-gray-800/70 hover:bg-gray-800 text-lg font-semibold text-amber-400">
                  <span>Saved Chats</span>
                  <span>{showSavedChats ? '▾':'▸'}</span>
                </button>
              {showSavedChats && (
                <div className="p-5 flex flex-col gap-4">
                  <button onClick={handleSaveCurrentChat} disabled={chatHistory.length===0} className="bg-amber-600 hover:bg-amber-700 disabled:bg-amber-800/50 disabled:cursor-not-allowed text-white px-4 py-2 rounded-lg text-sm font-semibold transition-colors">
                     Save Current Chat
                  </button>
                  {savedChats.length === 0 ? (
                     <p className="text-sm text-gray-500 text-center">No saved chats.</p>
                  ) : (
                     <div className="max-h-48 overflow-y-auto pr-2 flex flex-col gap-2">
                        {savedChats.map(c => (
                           <div key={c.id} className="group p-3 rounded-lg transition-all duration-200 border-2 bg-gray-700/50 hover:border-gray-600 flex justify-between items-center">
                              <div className="flex-1 cursor-pointer" onClick={()=>handleLoadChat(c.id)} title="Load chat">
                                 <p className="font-semibold text-sm truncate w-40">{c.title}</p>
                                 <p className="text-xs text-gray-400">{new Date(c.created).toLocaleDateString()}</p>
                              </div>
                              <button onClick={()=>handleDeleteSavedChat(c.id)} title="Delete saved chat" className="hidden group-hover:block text-red-400 hover:text-red-300 ml-2">✕</button>
                           </div>
                        ))}
                     </div>
                  )}
                </div>
              )}
            </div>
        </div>

        {/* Right Column: Chat Interface */}
        <div className="lg:col-span-2 bg-gray-800/60 rounded-2xl border border-gray-700/50 flex flex-col">
            <div className="p-4 border-b border-gray-700 flex justify-between items-center">
                <h2 className="text-lg font-semibold text-gray-200">Chat with <span className="text-green-400">{selectedModel || "No Model Selected"}</span></h2>
                <button 
                  onClick={handleClearChat} 
                  disabled={isStreaming || chatHistory.length === 0}
                  className="text-sm text-gray-400 hover:text-white disabled:text-gray-600 disabled:cursor-not-allowed transition-colors"
                  title="Clear Chat History">
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
                </button>
            </div>
            <div className="flex-1 p-4 overflow-y-auto" style={{maxHeight: 'calc(100vh - 260px)'}}>
                 {chatHistory.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full text-gray-500">
                        <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
                        <p className="mt-4">Select a model and start the conversation.</p>
                    </div>
                 ) : (
                    chatHistory.map((msg, index) => <ChatMessage key={index} message={msg} />)
                 )}
                <div ref={chatEndRef} />
            </div>
            <div className="p-4 border-t border-gray-700">
                {/* quick model select */}
                <div className="mb-3">
                  <select value={selectedModel} onChange={(e)=>{const m=models.find(x=>x.name===e.target.value); setSelectedModel(e.target.value); setSelectedModelInfo(m);}} className="bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm w-full disabled:bg-gray-800/50" disabled={isStreaming || models.length===0}>
                    <option value="" disabled>Select model...</option>
                    {models.map(m=>(<option key={m.name} value={m.name}>{m.name}</option>))}
                  </select>
                </div>
                <form onSubmit={handleChatSubmit} className="flex items-center gap-3">
                    <input 
                        type="text"
                        value={prompt}
                        onChange={(e) => setPrompt(e.target.value)}
                        placeholder={selectedModel ? `Ask ${selectedModel}...` : 'Select a model first'}
                        disabled={!selectedModel || isStreaming || !memOk}
                        className="w-full bg-gray-700 border border-gray-600 rounded-xl px-4 py-3 focus:ring-2 focus:ring-green-500 focus:outline-none transition-all"
                    />
                    <button 
                        type="submit" 
                        disabled={!prompt || isStreaming || !selectedModel || !memOk} 
                        className="bg-green-600 hover:bg-green-700 disabled:bg-green-800/50 disabled:cursor-not-allowed text-white rounded-xl p-3 flex-shrink-0 transition-colors shadow-lg hover:shadow-green-500/30">
                        {isStreaming ? (
                             <div className="w-6 h-6 border-2 border-white/50 border-t-white rounded-full animate-spin"></div>
                        ) : (
                            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>
                        )}
                    </button>
                </form>
            </div>
        </div>
      </main>
    </div>
  );
}
