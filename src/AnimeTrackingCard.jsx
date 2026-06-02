import React, { useState, useEffect, useMemo } from 'react';

const LIST_STATUS = {
  WATCHING: 'watching',    
  PLANNED: 'planned',      
  COMPLETED: 'completed'   
};

// 全域快取，避免重複請求觸發 Jikan API 429 限制
const globalApiCache = new Map();
let homeSeasonCache = null;

// Jikan API 類型與繁體中文映射表 (擴充所有 API 支援的分類)
const GENRE_ID_MAP = {
  'Action': 1, 'Adventure': 2, 'Comedy': 4, 'Avant Garde': 5, 'Mystery': 7,
  'Drama': 8, 'Ecchi': 9, 'Fantasy': 10, 'Historical': 13, 'Horror': 14,
  'Mecha': 18, 'Music': 19, 'Romance': 22, 'School': 23, 'Sci-Fi': 24,
  'Sports': 30, 'Slice of Life': 36, 'Supernatural': 37, 'Psychological': 40,
  'Suspense': 41, 'Award Winning': 46, 'Gourmet': 47, 'Work Life': 48, 'Isekai': 62
};

const GENRE_TRANSLATION_MAP = {
  '全部': '全部', 'Action': '動作', 'Adventure': '冒險', 'Comedy': '喜劇', 
  'Avant Garde': '前衛', 'Mystery': '推理', 'Drama': '劇情', 'Ecchi': '微色情', 
  'Fantasy': '奇幻', 'Historical': '歷史', 'Horror': '恐怖', 'Mecha': '機甲', 
  'Music': '音樂', 'Romance': '戀愛', 'School': '校園', 'Sci-Fi': '科幻', 
  'Sports': '運動', 'Slice of Life': '日常', 'Supernatural': '超自然', 
  'Psychological': '心理', 'Suspense': '懸疑', 'Award Winning': '得獎', 
  'Gourmet': '美食', 'Work Life': '職場', 'Isekai': '異世界'
};

const UI_GENRES = Object.keys(GENRE_TRANSLATION_MAP);
const UI_YEARS = ['全部', '即將上映', ...Array.from({length: 26}, (_, i) => (2026 - i).toString()), '2000以前'];
const UI_SEASONS = ['全部', 'Winter', 'Spring', 'Summer', 'Fall'];

const translateGenre = (enGenre) => GENRE_TRANSLATION_MAP[enGenre] || enGenre;

// 共用 Fetch 函數：強化版指數退避機制，徹底解決 429 崩潰問題
const fetchWithRetry = async (url, retries = 3, delay = 1000) => {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(url);
      
      if (response.status === 429) {
        await new Promise(r => setTimeout(r, delay * Math.pow(1.5, i)));
        continue;
      }
      
      if (response.status >= 400 && response.status < 500) {
        throw new Error(`Client Error: ${response.status}`);
      }
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      return await response.json();
    } catch (error) {
      if (error.message.includes('Client Error')) throw error; 
      if (i === retries - 1) throw error;
      await new Promise(r => setTimeout(r, delay * Math.pow(1.5, i)));
    }
  }
  throw new Error("API Fetch Failed");
};

// Jikan 專用：過濾中國番劇
const isChineseAnime = (item) => {
  if (!item) return false;

  const japanStudios = [
    'MAPPA', 'WIT STUDIO', 'MADHOUSE', 'TOEI ANIMATION', 'KYOTO ANIMATION', 
    'BONES', 'A-1 PICTURES', 'CLOVERWORKS', 'UFOTABLE', 'SHAFT', 
    'WHITE FOX', 'TRIGGER', 'SUNRISE', 'J.C.STAFF', 'PIERROT', 
    'PRODUCTION I.G', 'OLM', 'DAVID PRODUCTION', 'KADOKAWA', 'ANIPLEX', 'CYGAMES'
  ];
  const hasJapanStudio = item.studios?.some(s => japanStudios.some(js => s.name.toUpperCase().includes(js)));
  if (hasJapanStudio) return false; 

  const cnKeywords = ['bilibili', 'tencent', 'haoliners', 'iqiyi', 'youku', 'b.cmay', 'sparkly key', 'ruo hong', 'chongqing', 'studio lan'];
  const hasCnProducer = item.producers?.some(p => cnKeywords.some(kw => p.name.toLowerCase().includes(kw)));
  const hasCnStudio = item.studios?.some(s => cnKeywords.some(kw => s.name.toLowerCase().includes(kw)));
  
  return hasCnProducer || hasCnStudio;
};

// Jikan 專用：18+ 過濾
const is18PlusAnime = (item) => {
  if (!item) return false;
  const isAdultRating = item.rating?.includes('Rx');
  const isAdultGenre = item.genres ? 
    item.genres.some(g => g.name === 'Hentai' || g.name === 'Erotica') : 
    item.tags?.some(tag => tag === 'Hentai' || tag === 'Erotica');
  return isAdultRating || isAdultGenre;
};

// 格式化資料
const formatJikanAnime = (item) => {
  const daysEn = ['Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays', 'Sundays'];
  let bDayIndex = null;
  if (item.broadcast?.day) {
      const idx = daysEn.findIndex(d => item.broadcast.day.includes(d));
      if (idx !== -1) bDayIndex = idx;
  }

  const formattedScore = item.score ? item.score.toString() : 'N/A';
  
  let mapStatus = 'Unknown';
  if (item.status === 'Currently Airing') mapStatus = 'Releasing';
  else if (item.status === 'Finished Airing') mapStatus = 'Finished';
  else if (item.status === 'Not yet aired') mapStatus = 'Upcoming';

  return {
    id: item.mal_id,
    title: item.title_japanese || item.title,
    originalName: item.title_english || item.title,
    imageUrl: item.images?.jpg?.large_image_url || '',
    score: formattedScore,
    users: item.members || 0,
    rank: item.rank || '--',
    eps: item.episodes || null,
    status: mapStatus,
    format: item.type || 'TV',
    tags: item.genres?.map(g => g.name) || [],
    year: item.year || item.aired?.prop?.from?.year || '',
    season: item.season ? item.season.charAt(0).toUpperCase() + item.season.slice(1).toLowerCase() : '',
    broadcastDayIndex: bDayIndex,
    synopsis: item.synopsis || '暫無劇情簡介。',
    producers: item.producers || [],
    studios: item.studios || [],
    rating: item.rating,
    airDateStr: item.aired?.string || ''
  };
};

export default function App() {
  const [currentPage, setCurrentPage] = useState('home'); 
  const [searchQuery, setSearchQuery] = useState('');
  
  const [allSeasonAnime, setAllSeasonAnime] = useState([]);
  const [currentSeasonInfo, setCurrentSeasonInfo] = useState({});
  const [isHomeLoading, setIsHomeLoading] = useState(true);
  
  const [myPlaylist, setMyPlaylist] = useState(() => {
    const saved = localStorage.getItem('animePlaylist');
    return saved ? JSON.parse(saved) : [];
  });

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalData, setModalData] = useState(null);
  const [isModalLoading, setIsModalLoading] = useState(false);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);

  useEffect(() => {
    localStorage.setItem('animePlaylist', JSON.stringify(myPlaylist));
  }, [myPlaylist]);

  const handleAddToList = (anime, status = LIST_STATUS.PLANNED) => {
    const existingIndex = myPlaylist.findIndex(item => item.id === anime.id);
    if (existingIndex === -1) {
      setMyPlaylist([...myPlaylist, { ...anime, watched: 0, eps: anime.eps || 12, status }]);
      alert(`已將《${anime.title}》設定為：${status === LIST_STATUS.PLANNED ? 'Planning' : status === LIST_STATUS.WATCHING ? 'Watching' : 'Completed'}！`);
    } else {
      setMyPlaylist(prevList => prevList.map(item => item.id === anime.id ? { ...item, status } : item));
      alert(`已將《${anime.title}》狀態更新為：${status === LIST_STATUS.PLANNED ? 'Planning' : status === LIST_STATUS.WATCHING ? 'Watching' : 'Completed'}！`);
    }
    setIsDropdownOpen(false);
  };

  const handleChangeStatus = (animeId, newStatus) => {
    setMyPlaylist(prevList => prevList.map(anime => anime.id === animeId ? { ...anime, status: newStatus } : anime));
  };

  const handleRemoveFromList = (animeId) => {
    if(window.confirm('確定要從清單中移除這部動漫嗎？')) {
      setMyPlaylist(prevList => prevList.filter(anime => anime.id !== animeId));
    }
  };

  const handleUpdateProgress = (animeId, episodeNumber) => {
    setMyPlaylist(prevList => 
      prevList.map(anime => {
        if (anime.id === animeId) {
          const newWatched = anime.watched === episodeNumber ? episodeNumber - 1 : episodeNumber;
          let newStatus = anime.status;
          if (newWatched === anime.eps) newStatus = LIST_STATUS.COMPLETED;
          else if (newWatched > 0 && newWatched < anime.eps) newStatus = LIST_STATUS.WATCHING;
          return { ...anime, watched: newWatched, status: newStatus };
        }
        return anime;
      })
    );
  };

  const handleOpenModal = async (baseAnime) => {
    setIsModalOpen(true);
    setIsModalLoading(true);
    setIsDropdownOpen(false); 
    try {
      const detailResData = await fetchWithRetry(`https://api.jikan.moe/v4/anime/${baseAnime.id}/full`, 3, 1000);
      await new Promise(r => setTimeout(r, 400));
      const charResData = await fetchWithRetry(`https://api.jikan.moe/v4/anime/${baseAnime.id}/characters`, 3, 1000);
      
      const anime = detailResData.data;
      const charData = charResData;

      const formattedCharacters = (charData.data || []).slice(0, 8).map(c => ({
        id: c.character.mal_id,
        name: c.character.name,
        image: c.character.images?.jpg?.image_url,
        actorName: c.voice_actors?.find(va => va.language === 'Japanese')?.person.name || '未知'
      }));

      const airDateStr = anime.aired?.string || '未知';

      const fullData = {
        ...baseAnime,
        summary: anime.synopsis || '暫無劇情簡介。',
        airDate: airDateStr,
        eps: anime.episodes || baseAnime.eps || 12,
        characters: formattedCharacters,
        status: anime.status === 'Currently Airing' ? 'Releasing' : (anime.status === 'Finished Airing' ? 'Finished' : 'Upcoming')
      };

      setModalData(fullData);
      setMyPlaylist(prev => prev.map(item => item.id === baseAnime.id ? { ...item, eps: fullData.eps } : item));
    } catch (error) {
      setModalData({ ...baseAnime, summary: '資料載入失敗。請確認網路連線。' });
    } finally {
      setIsModalLoading(false);
    }
  };

  // 抓取 Jikan 當季新番資料
  useEffect(() => {
    let isMounted = true;
    const fetchAllAiringData = async () => {
      setIsHomeLoading(true);

      const d = new Date();
      const year = d.getFullYear();
      const month = d.getMonth() + 1;
      
      let currentSeason, currentYear, prevSeason, prevYear;
      
      if (month >= 1 && month <= 3) {
        currentSeason = 'Winter'; currentYear = year;
        prevSeason = 'Fall'; prevYear = year - 1;
      } else if (month >= 4 && month <= 6) {
        currentSeason = 'Spring'; currentYear = year;
        prevSeason = 'Winter'; prevYear = year;
      } else if (month >= 7 && month <= 9) {
        currentSeason = 'Summer'; currentYear = year;
        prevSeason = 'Spring'; prevYear = year;
      } else {
        currentSeason = 'Fall'; currentYear = year;
        prevSeason = 'Summer'; prevYear = year;
      }

      if (isMounted) {
        setCurrentSeasonInfo({ currentSeason, currentYear, prevSeason, prevYear });
      }

      if (homeSeasonCache) {
        if (isMounted) {
          setAllSeasonAnime(homeSeasonCache);
          setIsHomeLoading(false);
        }
        return;
      }

      try {
        let allFetched = [];
        let page = 1;
        let hasNext = true;

        while(hasNext && page <= 3) { 
          const json = await fetchWithRetry(`https://api.jikan.moe/v4/seasons/now?page=${page}`, 3, 1500);
          allFetched = [...allFetched, ...json.data.map(formatJikanAnime)];
          hasNext = json.pagination.has_next_page;
          page++;
          if (hasNext) await new Promise(r => setTimeout(r, 800)); 
        }
        
        if (isMounted) {
          const uniqueMap = new Map();
          allFetched.forEach(anime => uniqueMap.set(anime.id, anime));
          const uniqueList = Array.from(uniqueMap.values());
          
          const filtered = uniqueList.filter(a => 
            ['TV', 'ONA', 'Movie', 'OVA', 'Special'].includes(a.format) && 
            !isChineseAnime(a) && 
            !is18PlusAnime(a)
          );
          
          homeSeasonCache = filtered; 
          setAllSeasonAnime(filtered);
        }
      } catch (error) {
        console.error('Fetch error in Home:', error);
      } finally {
        if (isMounted) setIsHomeLoading(false);
      }
    };
    
    fetchAllAiringData();
    return () => { isMounted = false; };
  }, []);

  return (
    <div className="fixed inset-0 w-full h-full bg-white text-gray-900 font-sans flex flex-col overflow-hidden selection:bg-gray-200 selection:text-black border-0 outline-none m-0 p-0">
      
      {/* 導覽列 */}
      <nav className="h-16 shrink-0 w-full bg-white flex items-center justify-between px-6 lg:px-12 z-40 border-b border-gray-100">
        <div className="flex items-center gap-12">
          <div onClick={() => setCurrentPage('home')} className="text-2xl font-black text-black cursor-pointer hover:opacity-80 transition-opacity tracking-tight">
            aniview
          </div>
        </div>
        
        <div className="flex items-center gap-8">
          <div className="relative hidden sm:flex items-center group">
            <svg className="absolute left-3 w-4 h-4 text-gray-400 group-focus-within:text-black transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path></svg>
            <input 
              type="text" 
              placeholder="搜尋動漫..." 
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                if (e.target.value && currentPage === 'home') setCurrentPage('anime');
              }}
              className="bg-gray-50 text-sm text-gray-900 placeholder-gray-400 pl-9 pr-4 py-2 rounded-none w-48 md:w-64 focus:outline-none focus:bg-gray-100 transition-all border-none"
            />
          </div>
          
          <div className="hidden md:flex gap-8 font-bold text-sm text-gray-400">
            <button onClick={() => setCurrentPage('anime')} className={`transition-colors ${currentPage === 'anime' ? 'text-black' : 'hover:text-black'}`}>
              所有動畫
            </button>
            <button onClick={() => setCurrentPage('profile')} className={`transition-colors ${currentPage === 'profile' ? 'text-black' : 'hover:text-black'}`}>
              個人首頁
            </button>
          </div>
        </div>
      </nav>

      <main className="flex-1 overflow-hidden relative bg-white">
        {currentPage === 'home' && (
          <HomeView 
            allSeasonAnime={allSeasonAnime} 
            currentSeasonInfo={currentSeasonInfo}
            onAdd={handleAddToList} 
            onOpenModal={handleOpenModal}
            isLoading={isHomeLoading}
            setCurrentPage={setCurrentPage}
          />
        )}
        
        {currentPage === 'anime' && (
          <CatalogView 
            searchQuery={searchQuery}
            onAdd={handleAddToList} onOpenModal={handleOpenModal}
          />
        )}

        {currentPage === 'profile' && (
          <ProfileView 
            playlist={myPlaylist} onUpdateProgress={handleUpdateProgress}
            onChangeStatus={handleChangeStatus} onRemove={handleRemoveFromList} onOpenModal={handleOpenModal}
          />
        )}
      </main>

      {/* 詳細資訊 Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm cursor-pointer" onClick={() => setIsModalOpen(false)}></div>
          <div className="relative bg-white w-full max-w-4xl max-h-[90vh] overflow-y-auto rounded-none shadow-2xl flex flex-col md:flex-row">
            <button onClick={() => setIsModalOpen(false)} className="absolute top-4 right-4 z-10 bg-gray-100 text-gray-500 hover:bg-black hover:text-white w-8 h-8 rounded-none flex items-center justify-center transition-colors">✕</button>

            {isModalLoading ? (
              <div className="w-full p-32 text-center text-gray-400 font-mono text-sm flex flex-col items-center">
                <svg className="animate-spin h-8 w-8 text-black mb-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                Fetching data...
              </div>
            ) : modalData && (
              <>
                <div className="w-full md:w-[35%] bg-gray-50 p-8 flex flex-col items-center border-r border-gray-100">
                  <img src={modalData.imageUrl} alt="poster" className="w-full max-w-[220px] rounded-[24px] shadow-md mb-6 bg-gray-200" />
                  
                  {(() => {
                    const inPlaylist = myPlaylist.find(item => item.id === modalData.id);
                    
                    if (inPlaylist && inPlaylist.status === LIST_STATUS.WATCHING) {
                      return (
                        <div className="w-full mb-6">
                          <div className="bg-white text-center py-2 font-bold text-gray-800 text-sm border-b border-gray-100 flex justify-between px-4">
                            <span>進度 ({inPlaylist.watched} / {modalData.eps || '?'})</span>
                            <span className="text-black font-medium">觀看中</span>
                          </div>
                          <div className="bg-white p-3 flex gap-2 overflow-x-auto scrollbar-hide">
                            {Array.from({ length: modalData.eps || 12 }, (_, i) => i + 1).map(ep => (
                              <button
                                key={ep}
                                onClick={() => handleUpdateProgress(modalData.id, ep)}
                                className={`flex-none w-8 h-8 rounded-none text-xs font-bold transition-all ${
                                  ep <= inPlaylist.watched ? 'bg-black text-white' : 'bg-gray-50 text-gray-400 hover:bg-gray-200'
                                }`}
                              >
                                {ep}
                              </button>
                            ))}
                          </div>
                        </div>
                      );
                    } else {
                      return (
                        <div className="w-full max-w-[220px] mb-6 relative mx-auto">
                          <div className="flex w-full h-[44px] rounded-[4px] overflow-hidden bg-black text-white shadow-sm">
                            <button 
                              className="flex-1 font-medium text-[16px] hover:bg-gray-800 transition-colors flex items-center justify-center tracking-wide"
                              onClick={() => {
                                if (!inPlaylist) {
                                  handleAddToList(modalData, LIST_STATUS.PLANNED);
                                } else {
                                   setIsDropdownOpen(!isDropdownOpen);
                                }
                              }}
                            >
                              {inPlaylist 
                                ? (inPlaylist.status === LIST_STATUS.PLANNED ? 'Planning' : 'Completed')
                                : 'Add to List'}
                            </button>
                            <div className="w-[1px] bg-white/20"></div>
                            <button 
                              className="w-12 flex items-center justify-center hover:bg-gray-800 transition-colors"
                              onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                            >
                              <svg className={`w-5 h-5 transition-transform ${isDropdownOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M19 9l-7 7-7-7"></path></svg>
                            </button>
                          </div>

                          {isDropdownOpen && (
                            <div className="absolute top-[48px] left-0 w-full bg-white border border-gray-200 shadow-xl z-50 flex flex-col rounded-[4px]">
                              <button 
                                onClick={() => handleAddToList(modalData, LIST_STATUS.WATCHING)}
                                className="w-full text-left px-5 py-3 text-[15px] text-[#556376] hover:bg-gray-50 hover:text-black font-medium border-b border-gray-100 transition-colors"
                              >
                                Set as Watching
                              </button>
                              <button 
                                onClick={() => handleAddToList(modalData, LIST_STATUS.PLANNED)}
                                className="w-full text-left px-5 py-3 text-[15px] text-[#556376] hover:bg-gray-50 hover:text-black font-medium border-b border-gray-100 transition-colors"
                              >
                                Set as Planning
                              </button>
                              <button 
                                onClick={() => handleAddToList(modalData, LIST_STATUS.COMPLETED)}
                                className="w-full text-left px-5 py-3 text-[15px] text-[#556376] hover:bg-gray-50 hover:text-black font-medium transition-colors"
                              >
                                Set as Completed
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    }
                  })()}
                  
                  <div className="w-full space-y-3 text-sm text-gray-600 font-medium mt-auto">
                    <div className="flex justify-between pb-2 border-b border-gray-200"><span>評分</span><span className="text-black">{modalData.score} <StarIcon className="inline w-4 h-4 text-black -mt-1"/></span></div>
                    <div className="flex justify-between pb-2 border-b border-gray-200"><span>排名</span><span className="text-black">#{modalData.rank}</span></div>
                    <div className="flex justify-between pb-2 border-b border-gray-200"><span>總集數</span><span className="text-black">{modalData.eps || '?'} 集</span></div>
                    <div className="flex justify-between pb-2 border-b border-gray-200"><span>放送日期</span><span className="text-black">{modalData.airDate}</span></div>
                  </div>
                </div>

                <div className="w-full md:w-[65%] p-8 md:p-10 bg-white overflow-y-auto max-h-[90vh]">
                  <div className="mb-8">
                    <div className="flex items-center gap-2 mb-2">
                      <span className={`bg-black text-[10px] font-bold px-2 py-0.5 rounded-none tracking-wider ${modalData.status === 'Releasing' ? 'text-[#FEDFE1]' : 'text-white'}`}>{modalData.status}</span>
                      <span className="bg-gray-100 text-gray-600 text-[10px] font-bold px-2 py-0.5 rounded-none">{modalData.format}</span>
                    </div>
                    <h2 className="text-3xl font-black text-black mb-1 leading-tight">{modalData.title}</h2>
                    <p className="text-sm text-gray-400 mb-6 font-mono">{modalData.originalName}</p>
                    
                    <h3 className="text-sm font-bold text-black mb-2 uppercase tracking-wider">Synopsis</h3>
                    <p className="text-gray-600 text-sm leading-relaxed whitespace-pre-wrap">{modalData.summary}</p>
                  </div>

                  {modalData.characters && modalData.characters.length > 0 && (
                    <div className="mt-8 border-t border-gray-100 pt-8">
                      <h3 className="text-sm font-bold text-black mb-4 uppercase tracking-wider">Characters</h3>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        {modalData.characters.map(char => (
                          <div key={char.id} className="bg-gray-50 p-3 flex items-center gap-3 rounded-none transition-colors border-none">
                            {char.image ? <img src={char.image} alt={char.name} className="w-10 h-10 rounded-none object-cover shrink-0" /> : <div className="w-10 h-10 rounded-none bg-gray-200 shrink-0"></div>}
                            <div className="overflow-hidden">
                              <p className="text-sm text-gray-900 font-bold truncate">{char.name}</p>
                              <p className="text-xs text-gray-500 truncate">CV: {char.actorName}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ==========================================
// 子元件：首頁
// ==========================================
function HomeView({ allSeasonAnime, currentSeasonInfo, onAdd, onOpenModal, isLoading, setCurrentPage }) {
  const currentJS = new Date().getDay(); 
  const currentDayIndex = currentJS === 0 ? 6 : currentJS - 1; 
  const [activeTab, setActiveTab] = useState(currentDayIndex);
  
  const schedule = useMemo(() => {
    const daysZh = ['一', '二', '三', '四', '五', '六', '日'];
    const map = Array.from({ length: 7 }, (_, i) => ({ id: i, name: `周${daysZh[i]}`, items: [] }));
    const other = { id: 7, name: '其他 (完結/未定)', items: [] };
    
    const { currentSeason, currentYear, prevSeason, prevYear } = currentSeasonInfo;

    allSeasonAnime.forEach(anime => {
        const isCurrentSeason = anime.season?.toUpperCase() === currentSeason?.toUpperCase() && parseInt(anime.year) === currentYear;
        const isPrevSeason = anime.season?.toUpperCase() === prevSeason?.toUpperCase() && parseInt(anime.year) === prevYear;

        if ((isCurrentSeason || isPrevSeason) && anime.broadcastDayIndex !== null && anime.broadcastDayIndex >= 0 && anime.broadcastDayIndex <= 6) {
            map[anime.broadcastDayIndex].items.push(anime);
        } else {
            other.items.push(anime);
        }
    });
    if (other.items.length > 0) map.push(other);
    return map;
  }, [allSeasonAnime, currentSeasonInfo]);

  const currentList = schedule.find(s => s.id === activeTab)?.items || [];

  const rows = useMemo(() => {
    const result = [];
    for (let i = 0; i < currentList.length; i += 4) {
      result.push(currentList.slice(i, i + 4));
    }
    return result;
  }, [currentList]);

  return (
    <div className="flex flex-col lg:flex-row h-full overflow-hidden bg-white relative pb-8 items-start">
      
      {/* 修改：調整寬度佔比 (30%)，並加入 pl-12 讓整體向左對齊，不再向右擠 */}
      <div className="w-full lg:w-[35%] xl:w-[30%] h-full flex flex-col pt-[15vh] pb-[10vh] px-8 lg:pl-12 xl:pl-20 shrink-0 overflow-y-auto border-r border-gray-50/0">
        {/* 修改：拔除 ml-auto，加入 h-full 與 flex-col 以利下方按鈕沉底 */}
        <div className="max-w-[420px] w-full h-full flex flex-col">
          <p className="text-sm font-bold text-gray-500 mb-6 flex items-center gap-2 uppercase tracking-wide">
            We rely on you! Support us <span className="text-black cursor-pointer hover:underline">↗</span>
          </p>
          
          <h1 className="text-6xl lg:text-7xl font-black tracking-tight text-black mb-6 font-mono">
            Aniview<br/>Tracker
          </h1>
          
          <p className="text-gray-600 text-sm leading-relaxed mb-10 font-medium">
            Aniview Tracker is an unofficial & open-source platform for the 
            <strong> "most active online anime community and database"</strong> — powered by Jikan.
          </p>

          <div className="grid grid-cols-2 gap-y-4 gap-x-8 mb-10 text-xs font-bold text-gray-800">
            <div className="flex items-center gap-2"><span className="text-gray-400">#</span> REST API V4</div>
            <div className="flex items-center gap-2"><span className="text-gray-400">#</span> Rich Database</div>
            <div className="flex items-center gap-2"><span className="text-gray-400">#</span> Auth-less</div>
            <div className="flex items-center gap-2"><span className="text-gray-400">#</span> Local Storage</div>
          </div>

          {/* 修改：加入 mt-auto，將按鈕推移至版面下方最適合的位置 */}
          <div className="flex items-center gap-6 mt-auto pt-8">
            <button onClick={() => setCurrentPage('anime')} className="text-black font-bold text-sm hover:underline transition-all">
              Learn more
            </button>
            <button onClick={() => setCurrentPage('profile')} className="text-black font-bold text-sm flex items-center gap-1 hover:opacity-70 transition-all">
              ↗ Get started
            </button>
          </div>
        </div>
      </div>

      {/* 修改：右側卡片區塊給予更大的空間佔比 (70%) */}
      <div className="w-full lg:w-[65%] xl:w-[70%] h-full flex flex-col relative overflow-hidden">
        
        <div className="shrink-0 w-full pt-[15vh] pb-6 px-4 lg:px-8 flex flex-col items-start gap-5 z-10 bg-white">
          
          <div className="flex items-center gap-3 text-[11px] font-mono w-fit text-black">
            <span className="font-black tracking-wide">GET</span>
            <span className="font-bold truncate">https://api.jikan.moe/v4/seasons/now</span>
          </div>

          {!isLoading && allSeasonAnime.length > 0 && (
            <div className="flex gap-6 overflow-x-auto scrollbar-hide w-full justify-start">
              {schedule.map((day) => (
                <span 
                  key={day.id} 
                  onClick={() => setActiveTab(day.id)} 
                  className={`text-xs cursor-pointer transition-colors whitespace-nowrap font-bold uppercase tracking-wider ${activeTab === day.id ? 'text-black border-b-2 border-black pb-1' : 'text-gray-400 hover:text-black pb-1'}`}
                >
                  {day.name.replace('周', '')} {day.id === currentDayIndex && <span className="text-[9px] opacity-70 ml-0.5">(今日)</span>}
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto overflow-x-auto scrollbar-hide px-8 pb-24">
          {isLoading ? (
            <div className="w-full flex flex-col items-center justify-center text-gray-400 space-y-4 py-20">
              <svg className="animate-spin h-8 w-8 text-black" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
            </div>
          ) : rows.length > 0 ? (
            <div className="flex flex-col gap-4 w-max pb-12">
              {rows.map((row, rowIndex) => (
                <div 
                  key={rowIndex} 
                  className="flex gap-3 transition-all"
                  style={{ marginLeft: `${rowIndex * 1.25}rem` }}
                >
                  {row.map((anime) => (
                    <div key={anime.id} className="w-[360px] shrink-0">
                      <AnimeCardHome 
                        anime={anime} 
                        onAdd={() => onAdd(anime, LIST_STATUS.PLANNED)} 
                        onClick={() => onOpenModal(anime)} 
                      />
                    </div>
                  ))}
                </div>
              ))}
            </div>
          ) : (
            <div className="w-full flex items-start pt-12 justify-center text-gray-400 text-sm">此分類暫無播出中動漫</div>
          )}
        </div>
      </div>
      
      <div className="fixed bottom-0 left-0 w-full h-10 bg-white border-t border-gray-100 flex items-center overflow-hidden z-50">
        <div className="flex whitespace-nowrap animate-[scroll_40s_linear_infinite] text-[11px] font-mono text-gray-500 font-bold items-center">
          <span className="mx-6 text-black tracking-widest uppercase">Aniview's development is powered by</span> 
          {[...Array(6)].map((_, i) => (
            <React.Fragment key={i}>
              <span className="mx-6 hover:text-black cursor-pointer transition-colors">JetBrain's open source license</span>
              <span className="mx-6 hover:text-black cursor-pointer transition-colors text-black">♥ Supporters</span>
              <span className="mx-6 hover:text-black cursor-pointer transition-colors">Abdelhafid Achtaou</span>
              <span className="mx-6 hover:text-black cursor-pointer transition-colors">Jared Allaro</span>
              <span className="mx-6 hover:text-black cursor-pointer transition-colors">Aaron Treinish</span>
              <span className="mx-6 hover:text-black cursor-pointer transition-colors">Bobby Williams</span>
            </React.Fragment>
          ))}
        </div>
      </div>
      
      <style dangerouslySetInnerHTML={{__html: `
        body { margin: 0; padding: 0; background-color: #ffffff; border: none; }
        *, *:focus { outline: none !important; }
        .scrollbar-hide::-webkit-scrollbar { display: none; }
        .scrollbar-hide { -ms-overflow-style: none; scrollbar-width: none; }
        @keyframes scroll { 0% { transform: translateX(0); } 100% { transform: translateX(-50%); } }
      `}} />
    </div>
  );
}

// ==========================================
// 子元件：首頁專用橫向卡片 (中等尺寸)
// ==========================================
function AnimeCardHome({ anime, onClick, onAdd }) {
  const displayDate = anime.season && anime.year 
    ? `${anime.season} ${anime.year}` 
    : (anime.year ? anime.year : (anime.airDateStr ? anime.airDateStr.split(' to ')[0] : ''));

  return (
    <div className="flex gap-5 p-3.5 bg-white cursor-pointer relative group transition-all hover:shadow-md rounded-2xl border border-transparent hover:border-gray-100 w-full" onClick={onClick}>
      <img src={anime.imageUrl} alt={anime.title} className="w-[105px] h-[155px] object-cover rounded-[20px] shrink-0 bg-gray-100 shadow-sm transition-transform group-hover:scale-[1.02]" />
      <div className="flex flex-col flex-1 py-1 min-w-0">
        
        <div className={`text-[11px] font-bold mb-1 tracking-wide uppercase ${anime.status === 'Releasing' ? 'text-[#FEDFE1]' : 'text-gray-400'}`}>
          {anime.status}
        </div>
        
        <div className="text-[12px] text-gray-500 font-bold mb-1.5 flex items-center gap-2">
          {displayDate && <span>{displayDate}</span>}
          {anime.eps && <span>• {anime.eps} eps</span>}
        </div>
        
        <h3 className="text-[16px] font-bold text-black leading-tight line-clamp-2 pr-2 mb-2.5">
          {anime.title}
        </h3>
        
        <div className="flex items-center gap-5 mb-2 mt-auto">
          <div className="flex flex-col">
            <span className="text-[14px] text-black font-bold leading-none mb-1 flex items-center gap-1.5"><StarIcon className="w-4 h-4 text-black"/> {anime.score}</span>
            <span className="text-[10px] text-gray-400 font-bold leading-none">{anime.users ? (anime.users/1000).toFixed(0)+'k' : '0'} users</span>
          </div>
          {anime.rank && anime.rank !== '--' && (
            <div className="flex flex-col border-l border-gray-100 pl-5">
              <span className="text-[14px] text-black font-bold leading-none mb-1 flex items-center gap-1.5">#{anime.rank}</span>
              <span className="text-[10px] text-gray-400 font-bold leading-none">Ranking</span>
            </div>
          )}
        </div>
        
        <div className="flex flex-wrap gap-1 mt-1">
          {anime.tags?.slice(0, 2).map(tag => (
            <span key={tag} className="text-[10px] text-gray-600 font-bold px-0 rounded-none truncate max-w-[70px]">
              {translateGenre(tag)}
            </span>
          ))}
        </div>
      </div>

      <button onClick={(e) => { e.stopPropagation(); onAdd(anime); }} className="absolute bottom-3 right-3 bg-black text-white w-[34px] h-[34px] text-lg rounded-full opacity-0 group-hover:opacity-100 transition-all flex items-center justify-center font-bold hover:scale-110 shadow-md" title="加入待播清單">
        +
      </button>
    </div>
  );
}

// ==========================================
// 子元件：橫向卡片 (Explore/Profile 使用)
// ==========================================
function AnimeCardHorizontal({ anime, onClick, onAdd }) {
  const displayDate = anime.season && anime.year 
    ? `${anime.season} ${anime.year}` 
    : (anime.year ? anime.year : (anime.airDateStr ? anime.airDateStr.split(' to ')[0] : ''));

  return (
    <div className="flex gap-4 p-3 bg-white cursor-pointer relative group transition-all hover:shadow-lg rounded-2xl border border-transparent hover:border-gray-100 w-full" onClick={onClick}>
      <img src={anime.imageUrl} alt={anime.title} className="w-[85px] h-[125px] object-cover rounded-2xl shrink-0 bg-gray-100 shadow-sm transition-transform group-hover:scale-[1.02]" />
      <div className="flex flex-col flex-1 py-1 min-w-0">
        
        <div className={`text-[10px] font-bold mb-1 tracking-wide uppercase ${anime.status === 'Releasing' ? 'text-[#FEDFE1]' : 'text-gray-400'}`}>
          {anime.status}
        </div>
        
        <div className="text-[11px] text-gray-500 font-bold mb-1 flex items-center gap-2">
          {displayDate && <span>{displayDate}</span>}
          {anime.eps && <span>• {anime.eps} eps</span>}
        </div>
        
        <h3 className="text-[14px] font-bold text-black leading-tight line-clamp-2 pr-2 mb-2">
          {anime.title}
        </h3>
        
        <div className="flex items-center gap-4 mb-2 mt-auto">
          <div className="flex flex-col">
            <span className="text-[13px] text-black font-bold leading-none mb-1 flex items-center gap-1"><StarIcon className="w-3.5 h-3.5 text-black"/> {anime.score}</span>
            <span className="text-[9px] text-gray-400 font-bold leading-none">{anime.users ? (anime.users/1000).toFixed(0)+'k' : '0'} users</span>
          </div>
          {anime.rank && anime.rank !== '--' && (
            <div className="flex flex-col border-l border-gray-100 pl-4">
              <span className="text-[13px] text-black font-bold leading-none mb-1 flex items-center gap-1">#{anime.rank}</span>
              <span className="text-[9px] text-gray-400 font-bold leading-none">Ranking</span>
            </div>
          )}
        </div>
        
        <div className="flex flex-wrap gap-1 mt-1">
          {anime.tags?.slice(0, 2).map(tag => (
            <span key={tag} className="text-[9px] text-gray-600 font-bold px-0 rounded-none truncate max-w-[60px]">
              {translateGenre(tag)}
            </span>
          ))}
        </div>
      </div>

      <button onClick={(e) => { e.stopPropagation(); onAdd(anime); }} className="absolute bottom-3 right-3 bg-black text-white w-7 h-7 rounded-full opacity-0 group-hover:opacity-100 transition-all flex items-center justify-center font-bold hover:scale-110 shadow-md" title="加入待播清單">
        +
      </button>
    </div>
  );
}

// ==========================================
// 子元件：所有動畫 (搜尋與目錄) - 修復電影大小寫與前端排序機制
// ==========================================
function CatalogView({ searchQuery, onAdd, onOpenModal }) {
  const FORMATS = [
    { id: 'TV', label: 'TV 動畫' },
    { id: 'OVA', label: 'OVA / 特別篇' },
    { id: 'Movie', label: '劇場版' }
  ];
  
  const [activeFormat, setActiveFormat] = useState('TV'); 
  const [activeGenre, setActiveGenre] = useState('全部');
  const [activeSort, setActiveSort] = useState('SCORE_DESC');
  const [activeYear, setActiveYear] = useState('全部');
  const [activeSeason, setActiveSeason] = useState('全部');
  const [activeStatus, setActiveStatus] = useState('全部');
  
  const [data, setData] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [apiError, setApiError] = useState(null);

  useEffect(() => { setCurrentPage(1); }, [searchQuery, activeGenre, activeSort, activeYear, activeSeason, activeFormat, activeStatus]);

  useEffect(() => {
    let isMounted = true;
    const fetchFilteredData = async () => {
      setIsLoading(true);
      setApiError(null);
      try {
        // 修正點 1: activeFormat.toLowerCase() 確保 'Movie' 或 'OVA' 都能正確發送給 API
        let url = `https://api.jikan.moe/v4/anime?page=${currentPage}&limit=25&type=${activeFormat.toLowerCase()}`;
        if (searchQuery) url += `&q=${encodeURIComponent(searchQuery)}`;
        
        if (activeGenre !== '全部' && GENRE_ID_MAP[activeGenre]) url += `&genres=${GENRE_ID_MAP[activeGenre]}`;
        
        // 為了在前端能二次雙重排序，我們統一先向 API 要求基礎排序
        if (activeSort === 'SCORE_DESC') url += '&order_by=score&sort=desc'; 
        else if (activeSort === 'TRENDING_DESC') url += `&order_by=popularity&sort=asc`; 
        else if (activeSort === 'START_DATE_DESC') url += `&order_by=start_date&sort=desc`;

        // 修正點 2: 修復年份過濾邏輯，為所有年份加上 -01-01 到 -12-31 以符合 API 嚴格規定
        if (activeYear === '即將上映') {
          url += `&status=upcoming`;
        } else if (activeYear === '2000以前') {
          url += `&end_date=2000-12-31`;
        } else if (activeYear !== '全部') {
          let startMonth = '01-01'; let endMonth = '12-31';

          if (activeSeason === 'Winter') { startMonth = '01-01'; endMonth = '03-31'; }
          else if (activeSeason === 'Spring') { startMonth = '04-01'; endMonth = '06-30'; }
          else if (activeSeason === 'Summer') { startMonth = '07-01'; endMonth = '09-30'; }
          else if (activeSeason === 'Fall') { startMonth = '10-01'; endMonth = '12-31'; }

          url += `&start_date=${activeYear}-${startMonth}&end_date=${activeYear}-${endMonth}`;
        } else {
          if (activeStatus === 'RELEASING') url += `&status=airing`;
          else if (activeStatus === 'FINISHED') url += `&status=complete`;
        }

        if (globalApiCache.has(url)) {
          const cachedData = globalApiCache.get(url);
          if (isMounted) {
            setData(cachedData.formatted);
            setTotalPages(cachedData.totalPages);
            setIsLoading(false);
          }
          return;
        }

        const resData = await fetchWithRetry(url, 3, 1000);
        
        if (isMounted && resData.data) {
          const uniqueData = Array.from(new Map(resData.data.map(a => [a.mal_id, a])).values());
          
          const validData = uniqueData.filter(item => {
            if (isChineseAnime(item) || is18PlusAnime(item)) return false;
            return true;
          });

          let formatted = validData.map(formatJikanAnime);
          
          // 修正點 3: 解決 Top Rated 洗牌問題
          // 在前端進行嚴格的雙重排序 (同分時比較熱度)
          if (activeSort === 'SCORE_DESC') {
              formatted.sort((a, b) => {
                  const scoreA = a.score === 'N/A' ? 0 : parseFloat(a.score);
                  const scoreB = b.score === 'N/A' ? 0 : parseFloat(b.score);
                  if (scoreA !== scoreB) return scoreB - scoreA;
                  return b.users - a.users; // 同分時，人氣高的排前面
              });
          }

          const totalP = resData.pagination.last_visible_page || 1;
          
          globalApiCache.set(url, { formatted, totalPages: totalP });
          
          setData(formatted);
          setTotalPages(totalP);
        }
      } catch (error) {
        console.error(error);
        if(isMounted) {
            setData([]);
            setApiError(error.message.includes('Client Error') ? "沒有找到符合條件的動漫。" : "系統請求過於頻繁，請稍後再試。");
        }
      } finally {
        if (isMounted) setIsLoading(false);
      }
    };
    
    const timeoutId = setTimeout(fetchFilteredData, 600);
    return () => { isMounted = false; clearTimeout(timeoutId); };
  }, [searchQuery, activeGenre, activeSort, activeYear, activeSeason, activeFormat, activeStatus, currentPage]);

  const hasNextPage = currentPage < totalPages;

  return (
    <div className="h-full overflow-y-auto px-6 lg:px-16 py-10 pb-24 bg-white scrollbar-hide">
      <div className="max-w-7xl mx-auto">
        <h1 className="text-3xl font-black text-black mb-6 font-mono">
          Explore
          {searchQuery && <span className="text-lg text-gray-400 font-sans ml-4">/ Search: "{searchQuery}"</span>}
        </h1>
        
        <div className="flex bg-gray-100 p-1 rounded-none w-fit mb-8">
          {FORMATS.map(f => (
            <button
              key={f.id}
              onClick={() => { setActiveFormat(f.id); setCurrentPage(1); }}
              className={`px-8 py-2.5 text-sm font-bold transition-all rounded-none border-none ${activeFormat === f.id ? 'bg-black text-white shadow-sm' : 'bg-transparent text-gray-500 hover:text-black'}`}
            >
              {f.label}
            </button>
          ))}
        </div>
        
        <div className="flex flex-col mb-10">
          <div className="flex flex-col gap-6 w-full">
            
            <div className="flex items-center gap-6 overflow-x-auto scrollbar-hide">
              <span className="text-xs font-bold text-black uppercase tracking-wider shrink-0 w-12">Status</span>
              <div className="flex gap-2 w-max">
                {['全部', 'RELEASING', 'FINISHED'].map(s => (
                  <button 
                    key={`status-${s}`} 
                    onClick={() => { setActiveStatus(s); setCurrentPage(1); }} 
                    className={`shrink-0 px-4 py-1.5 rounded-none border-none text-xs font-bold transition-all whitespace-nowrap ${activeStatus === s ? 'bg-black text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}>
                    {s === '全部' ? '全部' : s === 'RELEASING' ? '連載中' : '已完結'}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-6 overflow-x-auto scrollbar-hide">
              <span className="text-xs font-bold text-black uppercase tracking-wider shrink-0 w-12">Genre</span>
              <div className="flex gap-2 w-max">
                {UI_GENRES.map(g => (
                  <button 
                    key={`genre-${g}`} 
                    onClick={() => { setActiveGenre(g); setCurrentPage(1); }} 
                    className={`shrink-0 px-4 py-1.5 rounded-none border-none text-xs font-bold transition-all whitespace-nowrap ${activeGenre === g ? 'bg-black text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}>
                    {translateGenre(g)}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-6 overflow-x-auto scrollbar-hide">
              <span className="text-xs font-bold text-black uppercase tracking-wider shrink-0 w-12">Year</span>
              <div className="flex gap-2 w-max">
                {UI_YEARS.map(y => (
                  <button 
                    key={`year-${y}`} 
                    onClick={() => { 
                      setActiveYear(y); 
                      setCurrentPage(1);
                      if (y === '全部' || y === '2000以前' || y === '即將上映') setActiveSeason('全部'); 
                    }} 
                    className={`shrink-0 px-4 py-1.5 rounded-none border-none text-xs font-bold transition-all whitespace-nowrap ${activeYear === y ? 'bg-black text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}>
                    {y}
                  </button>
                ))}
              </div>
            </div>

            <div className={`flex items-center gap-6 overflow-x-auto scrollbar-hide transition-opacity ${['全部', '2000以前', '即將上映'].includes(activeYear) ? 'opacity-20 pointer-events-none' : ''}`}>
              <span className="text-xs font-bold text-black uppercase tracking-wider shrink-0 w-12">Season</span>
              <div className="flex gap-2 w-max">
                {UI_SEASONS.map(s => (
                  <button 
                    key={`season-${s}`} 
                    onClick={() => { setActiveSeason(s); setCurrentPage(1); }} 
                    className={`shrink-0 px-4 py-1.5 rounded-none border-none text-xs font-bold transition-all whitespace-nowrap ${activeSeason === s ? 'bg-black text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
          </div>
          
          <div className="flex justify-end pt-6 mt-4">
            <div className="flex gap-2 shrink-0">
              <button onClick={() => { setActiveSort('SCORE_DESC'); setCurrentPage(1); }} className={`px-4 py-1.5 rounded-none text-xs font-bold transition-all border ${activeSort === 'SCORE_DESC' ? 'bg-black text-white border-black' : 'bg-transparent text-gray-400 border-gray-200 hover:border-black hover:text-black'}`}>Top Rated</button>
              <button onClick={() => { setActiveSort('TRENDING_DESC'); setCurrentPage(1); }} className={`px-4 py-1.5 rounded-none text-xs font-bold transition-all border ${activeSort === 'TRENDING_DESC' ? 'bg-black text-white border-black' : 'bg-transparent text-gray-400 border-gray-200 hover:border-black hover:text-black'}`}>Trending Now</button>
              <button onClick={() => { setActiveSort('START_DATE_DESC'); setCurrentPage(1); }} className={`px-4 py-1.5 rounded-none text-xs font-bold transition-all border ${activeSort === 'START_DATE_DESC' ? 'bg-black text-white border-black' : 'bg-transparent text-gray-400 border-gray-200 hover:border-black hover:text-black'}`}>Latest</button>
            </div>
          </div>
        </div>

        {isLoading ? (
          <div className="text-center py-32 text-gray-400 font-mono text-sm flex flex-col items-center">
            <svg className="animate-spin h-6 w-6 text-black mb-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
            Querying Jikan API...
          </div>
        ) : apiError ? (
          <div className="text-center py-32 text-gray-400 bg-gray-50 border border-gray-100 border-dashed rounded-none text-sm">
            {apiError}
          </div>
        ) : data.length === 0 ? (
          <div className="text-center py-32 text-gray-400 bg-gray-50 border border-gray-100 border-dashed rounded-none text-sm">
            找不到符合條件的動畫，請嘗試其他篩選組合。
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6 mb-10 max-w-5xl mx-auto">
              {data.map((anime) => (
                <div key={`cat-${anime.id}`} className="w-full">
                  <AnimeCardHorizontal anime={anime} onAdd={() => onAdd(anime, LIST_STATUS.PLANNED)} onClick={() => onOpenModal(anime)} />
                </div>
              ))}
            </div>
            
            <div className="flex justify-center items-center gap-4 pt-4 border-t border-gray-100 mt-8">
              <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1} className="px-6 py-2 text-sm font-bold text-black disabled:text-gray-300 disabled:bg-transparent bg-gray-100 hover:bg-gray-200 transition-all rounded-none border-none">PREV</button>
              <span className="text-sm font-mono text-black font-bold px-4 py-1.5">Page {currentPage} {hasNextPage ? '...' : ''}</span>
              <button onClick={() => setCurrentPage(p => p + 1)} disabled={!hasNextPage} className="px-6 py-2 text-sm font-bold text-black disabled:text-gray-300 disabled:bg-transparent bg-gray-100 hover:bg-gray-200 transition-all rounded-none border-none">NEXT</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ==========================================
// 子元件：個人清單專區
// ==========================================
function ProfileView({ playlist, onUpdateProgress, onRemove, onOpenModal }) {
  const [activeTab, setActiveTab] = useState(LIST_STATUS.WATCHING);
  const tabs = [
    { id: LIST_STATUS.WATCHING, label: 'Watching' },
    { id: LIST_STATUS.PLANNED, label: 'Plan to Watch' },
    { id: LIST_STATUS.COMPLETED, label: 'Completed' }
  ];
  const currentList = playlist.filter(item => item.status === activeTab);

  return (
    <div className="h-full overflow-y-auto px-6 lg:px-16 py-10 pb-24 bg-white scrollbar-hide">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center justify-between border-b border-gray-100 pb-8 mb-8">
          <div>
            <h1 className="text-3xl font-black text-black mb-2 font-mono">My Profile</h1>
            <p className="text-gray-400 text-sm">
              Tracked: {playlist.length} | Completed: {playlist.filter(i => i.status === LIST_STATUS.COMPLETED).length}
            </p>
          </div>
          <div className="w-16 h-16 bg-black flex items-center justify-center text-2xl text-white font-bold font-mono rounded-none">
            M
          </div>
        </div>

        <div className="flex gap-8 mb-10 border-b border-gray-50 pb-2">
          {tabs.map(tab => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)} className={`pb-2 text-sm font-bold transition-colors border-none bg-transparent relative ${activeTab === tab.id ? 'text-black' : 'text-gray-400 hover:text-black'}`}>
              {tab.label}
              <span className={`ml-2 text-[10px] px-2 py-0.5 rounded-none ${activeTab === tab.id ? 'bg-black text-white' : 'bg-gray-100 text-gray-500'}`}>{playlist.filter(i => i.status === tab.id).length}</span>
              {activeTab === tab.id && <div className="absolute -bottom-2 left-0 w-full h-0.5 bg-black"></div>}
            </button>
          ))}
        </div>

        {currentList.length === 0 ? (
          <div className="text-center py-24 bg-gray-50 border border-gray-100 border-dashed text-gray-400 text-sm font-mono rounded-none">
            List is empty.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6 max-w-5xl mx-auto">
            {currentList.map(anime => {
               const isWatching = activeTab === LIST_STATUS.WATCHING;

               return (
                <div key={`profile-${anime.id}`} className="bg-white p-4 flex gap-4 relative group transition-all border border-gray-50 hover:border-gray-200 rounded-2xl">
                  <img src={anime.imageUrl} alt="poster" className="w-[75px] h-[105px] object-cover rounded-xl cursor-pointer shrink-0 bg-gray-100 shadow-sm hover:scale-[1.02] transition-transform" onClick={() => onOpenModal(anime)} />
                  <div className="flex-1 flex flex-col min-w-0">
                    
                    {!isWatching && (
                      <div className={`text-[10px] font-bold mb-1 tracking-wide uppercase ${anime.status === 'Releasing' ? 'text-[#FEDFE1]' : 'text-gray-400'}`}>
                        {anime.status}
                      </div>
                    )}
                    
                    <h3 className={`font-bold text-sm text-black truncate cursor-pointer hover:underline ${!isWatching ? 'mb-2' : 'mb-1'}`} onClick={() => onOpenModal(anime)}>{anime.title}</h3>
                    
                    {isWatching ? (
                      <p className="text-[10px] text-gray-400 font-mono mb-4">Total: {anime.eps || '?'} eps</p>
                    ) : (
                      <div className="text-[11px] text-gray-500 font-bold mb-1 flex items-center gap-2">
                        {anime.season || anime.year ? <span>{anime.season} {anime.year}</span> : null}
                        <span className="flex items-center gap-1"><StarIcon className="w-3 h-3 text-black"/> {anime.score}</span>
                      </div>
                    )}
                    
                    <div className="mt-auto">
                      {isWatching && (
                        <>
                          <div className="flex justify-between items-center text-[10px] mb-2 font-bold text-gray-400 uppercase tracking-wider">
                            <span>Progress</span>
                            <span className="text-black">{anime.watched} / {anime.eps || '?'}</span>
                          </div>
                          <div className="w-full bg-gray-100 rounded-none h-1.5 mb-4 overflow-hidden">
                            <div className="bg-black h-full transition-all" style={{ width: `${Math.min(100, (anime.watched / (anime.eps || 12)) * 100)}%` }}></div>
                          </div>
                        </>
                      )}
                      
                      <div className={`flex justify-end gap-2 ${!isWatching ? 'mt-auto' : 'mt-2'}`}>
                        {isWatching && (
                          <button onClick={() => onUpdateProgress(anime.id, anime.watched + 1)} className="bg-gray-100 text-black px-3 py-1.5 rounded-none text-[10px] font-bold hover:bg-black hover:text-white transition-colors border-none">1 EP</button>
                        )}
                        <button onClick={() => onRemove(anime.id)} className="text-gray-400 hover:text-white hover:bg-red-500 px-3 py-1.5 rounded-none text-[10px] font-bold transition-colors border-none">Remove</button>
                      </div>
                    </div>
                  </div>
                </div>
               );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// 輔助 Icon 元件
function CheckIcon() {
  return <svg className="w-4 h-4 text-black shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7"></path></svg>;
}
// 星星替換為中空 (Outlined) 樣式
function StarIcon({className}) {
  return <svg className={className} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z"></path></svg>;
}