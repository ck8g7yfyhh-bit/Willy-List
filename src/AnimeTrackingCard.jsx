import React, { useState, useEffect, useMemo } from 'react';

import wattpadLogo from './assets/wattpad.png'; 
import codeIcon from './assets/code.png'; 
import anilistIcon from './assets/anilist.svg'; 
import developerIcon from './assets/developer.png'; 
import notionIcon from './assets/notion-icon.svg'; 
import sparkleIcon from './assets/sparkle.png'; 
import anilistLogoWhite from './assets/AniList_logo white.svg'; 
import anilistLogo from './assets/AniList_logo.svg.png';

const LIST_STATUS = {
  WATCHING: 'watching',    
  PLANNED: 'planned',      
  COMPLETED: 'completed'   
};

const globalApiCache = new Map();
let homeSeasonCache = null;

const GENRE_MAP = {
  '全部': '', 'Action': '動作', 'Adventure': '冒險', 'Comedy': '喜劇', 
  'Drama': '劇情', 'Fantasy': '奇幻', 'Romance': '戀愛', 'Sci-Fi': '科幻', 
  'Slice of Life': '日常', 'Sports': '運動', 'Supernatural': '超自然', 
  'Mystery': '懸疑', 'Mecha': '機甲', 'Suspense': '懸疑', 'Ecchi': '微色情',
  'Horror': '恐怖', 'Psychological': '心理', 'Isekai': '異世界',
  'Music': '音樂', 'Historical': '歷史', 'School': '校園',
  'Harem': '後宮', 'Iyashikei': '治癒', 'Award Winning': '得獎',
  'Gourmet': '美食', 'Workplace': '職場', 'Time Travel': '時空',
  'Reincarnation': '轉生', 'Detective': '推理',
  'Military': '軍事', 'Super Power': '超能力', 'Avant Garde': '前衛',
  'Mythology': '神話', 'Strategy Game': '策略遊戲', 'Martial Arts': '武術',
  'Parody': '惡搞', 'Samurai': '武士', 'Shoujo': '少女', 'Shounen': '少年',
  'Space': '太空', 'Seinen': '青年', 'Josei': '女性', 'Combat Sports': '格鬥運動',
  'Gore': '血腥', 'Love Polygon': '多角戀', 'Pets': '寵物', 'Reverse Harem': '逆後宮',
  'Romantic Subtext': '戀愛暗示', 'Survival': '生存',
  'Team Sports': '團隊運動', 'Video Game': '電子遊戲', 'Visual Gag': '視覺搞笑',
  'Crossdressing': '偽娘/男裝', 'Boys Love': 'BL', 'Girls Love': '百合',
  'Mahou Shoujo': '魔法少女', 'Idol': '偶像', 'CGDCT': '萌系', 'Thriller': '驚悚'
};

const UI_GENRES = ['全部', 'Action', 'Adventure', 'Comedy', 'Drama', 'Ecchi', 'Fantasy', 'Horror', 'Mahou Shoujo', 'Mecha', 'Music', 'Mystery', 'Psychological', 'Romance', 'Sci-Fi', 'Slice of Life', 'Sports', 'Supernatural', 'Thriller'];
const UI_YEARS = ['全部', '即將上映', ...Array.from({length: 26}, (_, i) => (2026 - i).toString()), '2000以前'];
const UI_SEASONS = ['全部', 'Winter', 'Spring', 'Summer', 'Fall'];

const translateGenre = (enGenre) => GENRE_MAP[enGenre] || enGenre;

const fetchAniList = async (query, variables = {}, retries = 3, delay = 1000) => {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch('https://graphql.anilist.co', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ query, variables })
      });
      
      if (response.status === 429) {
        const retryAfter = response.headers.get('Retry-After');
        const waitTime = retryAfter ? parseInt(retryAfter) * 1000 : delay * Math.pow(1.5, i);
        await new Promise(r => setTimeout(r, waitTime));
        continue;
      }
      
      if (response.status >= 400 && response.status < 500 && response.status !== 429) {
        throw new Error(`Client Error: ${response.status}`);
      }
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const json = await response.json();
      if (json.errors) throw new Error(json.errors[0].message);
      return json.data;
    } catch (error) {
      if (error.message.includes('Client Error')) throw error; 
      if (i === retries - 1) throw error;
      await new Promise(r => setTimeout(r, delay * Math.pow(1.5, i)));
    }
  }
  throw new Error("API Fetch Failed");
};

const formatAnilistAnime = (media) => {
  if (!media) return null;

  const isAdultContent = media.isAdult || (media.genres && media.genres.includes('Hentai'));
  let bDayIndex = 7; 
  
  const forceToOther = 
    isAdultContent ||
    media.status === 'FINISHED' || 
    ['MUSIC', 'SPECIAL', 'TV_SHORT', 'OVA', 'MOVIE'].includes(media.format);

  if (forceToOther) {
    bDayIndex = 7;
  } else if (media.nextAiringEpisode?.airingAt) {
    const jstDate = new Date((media.nextAiringEpisode.airingAt + 32400) * 1000);
    const jsDay = jstDate.getUTCDay(); 
    bDayIndex = jsDay === 0 ? 6 : jsDay - 1; 
  } else if (media.status === 'RELEASING') {
    bDayIndex = 7;
  }

  const formattedScore = media.meanScore ? (media.meanScore / 10).toFixed(1) : 'N/A';
  
  let mapStatus = 'Unknown';
  if (media.status === 'RELEASING') mapStatus = 'Currently Airing';
  else if (media.status === 'FINISHED') mapStatus = 'Finished Airing';
  else if (media.status === 'NOT_YET_RELEASED') mapStatus = 'Upcoming';

  const cleanSynopsis = media.description?.replace(/<[^>]*>?/gm, '') || '暫無劇情簡介。';
  
  let airDateStr = '';
  if (media.startDate?.year) {
      airDateStr = `${media.startDate.year}-${String(media.startDate.month || 1).padStart(2,'0')}-${String(media.startDate.day || 1).padStart(2,'0')}`;
  }
  const seasonStr = media.season ? media.season.charAt(0).toUpperCase() + media.season.slice(1).toLowerCase() : '';

  let mappedFormat = media.format || 'TV';
  if (mappedFormat === 'TV_SHORT') mappedFormat = 'TV Short';
  else if (mappedFormat === 'SPECIAL') mappedFormat = 'Special';
  else if (mappedFormat === 'MUSIC') mappedFormat = 'Music';

  return {
    id: media.id,
    title: media.title.native || media.title.romaji || media.title.english,
    originalName: media.title.english || media.title.romaji,
    imageUrl: media.coverImage?.large || media.coverImage?.medium || '',
    score: formattedScore,
    users: media.popularity || 0,
    rank: '--', 
    eps: media.episodes || null,
    status: mapStatus,
    format: mappedFormat,
    tags: media.genres || [],
    year: media.seasonYear || media.startDate?.year || '',
    season: seasonStr,
    broadcastDayIndex: bDayIndex,
    synopsis: cleanSynopsis,
    airDateStr: airDateStr,
    isAdultContent: isAdultContent
  };
};

export default function App() {
  const [theme, setTheme] = useState(() => {
    try {
      const savedTheme = localStorage.getItem('app-theme');
      if (savedTheme) return savedTheme;
      return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    } catch (e) {
      return 'light';
    }
  });

  // 新增：設定分頁標題與圖標
  useEffect(() => {
    document.title = 'Willy-List';
    let link = document.querySelector("link[rel~='icon']");
    if (!link) {
      link = document.createElement('link');
      link.rel = 'icon';
      document.head.appendChild(link);
    }
    link.href = './assets/wattpad.png';
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem('app-theme', theme);
    } catch (e) {}
  }, [theme]);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = (e) => {
      setTheme(e.matches ? 'dark' : 'light');
    };
    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener('change', handleChange);
      return () => mediaQuery.removeEventListener('change', handleChange);
    }
  }, []);

  const [currentPage, _setCurrentPage] = useState(() => {
    try {
      const hash = window.location.hash.replace('#', '');
      return ['home', 'anime', 'profile'].includes(hash) ? hash : 'home';
    } catch (e) {
      return 'home';
    }
  });
  
  const setCurrentPage = (page) => {
    _setCurrentPage(page);
    try {
      window.history.pushState({ page }, '', `#${page}`);
    } catch (e) {
    }
  };

  const [searchQuery, setSearchQuery] = useState('');
  const [allSeasonAnime, setAllSeasonAnime] = useState([]);
  const [currentSeasonInfo, setCurrentSeasonInfo] = useState({});
  const [isHomeLoading, setIsHomeLoading] = useState(true);
  const [toast, setToast] = useState(null);
  
  const [myPlaylist, setMyPlaylist] = useState(() => {
    const saved = localStorage.getItem('animePlaylist');
    return saved ? JSON.parse(saved) : [];
  });

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalData, setModalData] = useState(null);
  const [isModalLoading, setIsModalLoading] = useState(false);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);

  useEffect(() => {
    try {
      if (!window.location.hash) {
        window.history.replaceState({ page: 'home' }, '', '#home');
      }
    } catch (e) {}

    const handlePopState = (e) => {
      try {
        setIsModalOpen(false); 
        if (e.state && e.state.page) {
          if (['home', 'anime', 'profile'].includes(e.state.page)) {
            _setCurrentPage(e.state.page);
            return;
          }
        }
        const hash = window.location.hash.replace('#', '');
        if (['home', 'anime', 'profile'].includes(hash)) {
          _setCurrentPage(hash);
        }
      } catch (error) {}
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  useEffect(() => {
    localStorage.setItem('animePlaylist', JSON.stringify(myPlaylist));
  }, [myPlaylist]);

  const showToast = (message) => {
    setToast(message);
    setTimeout(() => setToast(null), 3000);
  };

  const handleAddToList = (anime, status = LIST_STATUS.PLANNED) => {
    const existingIndex = myPlaylist.findIndex(item => item.id === anime.id);
    const statusText = status === LIST_STATUS.PLANNED ? 'Planning' : status === LIST_STATUS.WATCHING ? 'Watching' : 'Completed';
    
    if (existingIndex === -1) {
      setMyPlaylist([...myPlaylist, { ...anime, watched: 0, eps: anime.eps || 12, status }]);
      showToast(`已將《${anime.title}》設定為 ${statusText}！`);
    } else {
      setMyPlaylist(prevList => prevList.map(item => item.id === anime.id ? { ...item, status } : item));
      showToast(`已將《${anime.title}》更新為 ${statusText}！`);
    }
    setIsDropdownOpen(false);
  };

  const handleChangeStatus = (animeId, newStatus) => {
    setMyPlaylist(prevList => prevList.map(anime => anime.id === animeId ? { ...anime, status: newStatus } : anime));
  };

  const handleRemoveFromList = (animeId) => {
    setMyPlaylist(prevList => prevList.filter(anime => anime.id !== animeId));
    showToast('已從清單中移除。');
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
      const query = `
        query($id: Int) {
          Media(id: $id, type: ANIME) {
            id 
            trailer { id site thumbnail }
            characters(sort: ROLE, perPage: 8) {
              edges { role node { id name { full } image { large } } voiceActors(language: JAPANESE) { name { full } } }
            }
          }
        }
      `;
      const charResData = await fetchAniList(query, { id: baseAnime.id });
      
      const formattedCharacters = (charResData.Media?.characters?.edges || []).map(c => ({
        id: c.node.id,
        name: c.node.name.full,
        image: c.node.image?.large,
        actorName: c.voiceActors && c.voiceActors.length > 0 ? c.voiceActors[0].name.full : '未知'
      }));

      const trailerData = charResData.Media?.characters?.trailer || charResData.Media?.trailer;
      let trailerUrl = null;
      if (trailerData) {
        if (trailerData.site?.toLowerCase() === 'youtube') {
          trailerUrl = `https://www.youtube.com/embed/${trailerData.id}`;
        } else if (trailerData.site?.toLowerCase() === 'dailymotion') {
          trailerUrl = `https://www.dailymotion.com/embed/video/${trailerData.id}`;
        }
      }

      const fullData = {
        ...baseAnime,
        eps: baseAnime.eps || 12,
        characters: formattedCharacters,
        trailer: trailerUrl,
        trailerRaw: trailerData
      };

      setModalData(fullData);
      setMyPlaylist(prev => prev.map(item => item.id === baseAnime.id ? { ...item, eps: fullData.eps } : item));
    } catch (error) {
      setModalData({ ...baseAnime });
    } finally {
      setIsModalLoading(false);
    }
  };

  useEffect(() => {
    let isMounted = true;
    
    const fetchAllAiringData = async () => {
      setIsHomeLoading(true);

      const d = new Date();
      const year = d.getFullYear();
      const month = d.getMonth() + 1;
      
      let currentSeason, currentYear, prevSeason, prevYear;
      
      if (month >= 1 && month <= 3) { currentSeason = 'WINTER'; currentYear = year; prevSeason = 'FALL'; prevYear = year - 1; } 
      else if (month >= 4 && month <= 6) { currentSeason = 'SPRING'; currentYear = year; prevSeason = 'WINTER'; prevYear = year; } 
      else if (month >= 7 && month <= 9) { currentSeason = 'SUMMER'; currentYear = year; prevSeason = 'SPRING'; prevYear = year; } 
      else { currentSeason = 'FALL'; currentYear = year; prevSeason = 'SUMMER'; prevYear = year; }

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

        const fetchSeasonPage = async (season, year, isCurrentSeason) => {
          let hasNextPage = true;
          let page = 1;
          const maxPages = isCurrentSeason ? 5 : 2; 

          while (hasNextPage && page <= maxPages) {
            const query = `
              query($season: MediaSeason, $seasonYear: Int, $page: Int) {
                Page(page: $page, perPage: 50) {
                  pageInfo { hasNextPage }
                  media(season: $season, seasonYear: $seasonYear, type: ANIME, countryOfOrigin: "JP", sort: POPULARITY_DESC) {
                    id title { romaji english native } coverImage { large } meanScore popularity episodes status format genres season seasonYear description nextAiringEpisode { airingAt } startDate { year month day } isAdult
                  }
                }
              }
            `;
            const data = await fetchAniList(query, { season, seasonYear: year, page });
            
            if (data.Page && data.Page.media) {
              const filterStatus = isCurrentSeason ? [] : ['RELEASING'];
              const filteredMedia = data.Page.media.filter(a => 
                (isCurrentSeason || filterStatus.includes(a.status)) &&
                !a.isAdult && 
                !(a.genres && a.genres.includes('Hentai'))
              );
              allFetched = [...allFetched, ...filteredMedia];
            }
            
            hasNextPage = data.Page?.pageInfo?.hasNextPage || false;
            page++;
          }
        };

        await fetchSeasonPage(currentSeason, currentYear, true);
        await fetchSeasonPage(prevSeason, prevYear, false);

        if (isMounted) {
          const uniqueMap = new Map();
          allFetched.forEach(anime => {
             if(['TV', 'ONA', 'OVA', 'SPECIAL', 'TV_SHORT', 'MUSIC'].includes(anime.format)) {
                 uniqueMap.set(anime.id, anime);
             }
          });
          
          const formatted = Array.from(uniqueMap.values()).map(formatAnilistAnime);
          
          homeSeasonCache = formatted; 
          setAllSeasonAnime(formatted);
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
    <div className={`fixed inset-0 w-full h-full font-sans flex flex-col overflow-hidden border-0 outline-none m-0 p-0 transition-colors duration-300 ${theme === 'dark' ? 'bg-[#0a0a0a] text-gray-100 selection:bg-gray-700' : 'bg-white text-gray-900 selection:bg-gray-200'}`}>
      
      {toast && (
        <div className={`fixed top-20 right-6 z-50 px-6 py-3 rounded-none shadow-xl text-sm font-bold flex items-center gap-3 animate-fade-in-down border transition-colors duration-300 ${theme === 'dark' ? 'bg-white text-black border-gray-200' : 'bg-black text-white border-gray-800'}`}>
          <CheckIcon className={`w-5 h-5 ${theme === 'dark' ? 'text-black' : 'text-white'}`} />
          {toast}
        </div>
      )}

      {/* 修改 Nav 讓 Logo 精準對齊下方的 Willy List 文字 (左側區域為 35%) */}
      <nav className={`h-24 shrink-0 w-full flex items-center justify-between z-40 transition-colors duration-300 ${theme === 'dark' ? 'bg-[#0a0a0a]' : 'bg-white'}`}>
        <div className="w-full lg:w-[35%] flex items-center px-8 lg:pl-8 lg:pr-8">
          <div className="w-full max-w-[480px] ml-auto flex items-center">
            <div onClick={() => setCurrentPage('home')} className="flex items-center cursor-pointer hover:opacity-80 transition-opacity">
              {wattpadLogo ? <img src={wattpadLogo} alt="logo" className={`w-12 h-12 lg:w-[60px] lg:h-[60px] object-contain transition-all duration-300 ${theme === 'dark' ? 'invert' : ''}`} /> : <div className="w-12 h-12 lg:w-[60px] lg:h-[60px] bg-gray-200 rounded-full"></div>}
            </div>
          </div>
        </div>
        
        <div className="flex-1 flex justify-end items-center px-8 md:pr-12 lg:pr-24 min-[1920px]:pr-[280px]">
          <div className={`hidden md:flex items-center gap-8 lg:gap-12 font-bold text-sm ${theme === 'dark' ? 'text-white' : 'text-black'}`}>
            <button onClick={() => setCurrentPage('anime')} className={`flex items-center transition-colors border-none bg-transparent hover:opacity-70 ${theme === 'dark' ? 'text-white' : 'text-black'}`}>
              <svg className="w-3.5 h-3.5 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M10 6H18V14M18 6L6 18"></path></svg>
              Anime
            </button>
            <button onClick={() => setCurrentPage('profile')} className={`flex items-center transition-colors border-none bg-transparent hover:opacity-70 ${theme === 'dark' ? 'text-white' : 'text-black'}`}>
              <svg className="w-3.5 h-3.5 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M10 6H18V14M18 6L6 18"></path></svg>
              My Profile
            </button>

            {/* Dark / Light Toggle Slider */}
            <button 
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
              className={`relative w-10 h-5 flex items-center rounded-full p-0.5 cursor-pointer transition-colors duration-300 border-none ml-2 ${theme === 'dark' ? 'bg-[#222]' : 'bg-gray-200'}`}
              title="切換日夜模式"
            >
              <div className={`w-4 h-4 rounded-full shadow-sm transform transition-transform duration-300 flex items-center justify-center bg-white ${theme === 'dark' ? 'translate-x-5' : 'translate-x-0'}`}>
                {theme === 'dark' ? (
                  <svg className="w-2.5 h-2.5 text-gray-800" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                  </svg>
                ) : (
                  <svg className="w-2.5 h-2.5 text-gray-800" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
                  </svg>
                )}
              </div>
            </button>
          </div>
          
          <div className="relative hidden sm:flex items-center group ml-8 lg:ml-12">
            <svg className={`absolute left-0 w-4 h-4 transition-colors duration-300 ${theme === 'dark' ? 'text-white' : 'text-black'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path></svg>
            <input 
              type="text" 
              placeholder="Search for Anime..." 
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                if (e.target.value && currentPage === 'home') setCurrentPage('anime');
              }}
              className={`text-sm pl-7 pr-2 py-1.5 rounded-none w-48 md:w-56 focus:outline-none transition-colors border-none bg-transparent border-b ${theme === 'dark' ? 'text-white placeholder-gray-500 border-gray-600 focus:border-white' : 'text-black placeholder-gray-400 border-gray-300 focus:border-black'}`}
              style={{ borderBottomWidth: '1px' }}
            />
          </div>

        </div>
      </nav>

      <main className={`flex-1 overflow-hidden relative transition-colors duration-300 ${theme === 'dark' ? 'bg-[#0a0a0a]' : 'bg-white'}`}>
        {currentPage === 'home' && (
          <HomeView 
            allSeasonAnime={allSeasonAnime} 
            currentSeasonInfo={currentSeasonInfo}
            onAdd={handleAddToList} 
            onOpenModal={handleOpenModal}
            isLoading={isHomeLoading}
            setCurrentPage={setCurrentPage}
            theme={theme}
          />
        )}
        
        {currentPage === 'anime' && (
          <CatalogView 
            searchQuery={searchQuery}
            onAdd={handleAddToList} onOpenModal={handleOpenModal}
            theme={theme}
          />
        )}

        {currentPage === 'profile' && (
          <ProfileView 
            playlist={myPlaylist} onUpdateProgress={handleUpdateProgress}
            onChangeStatus={handleChangeStatus} onRemove={handleRemoveFromList} onOpenModal={handleOpenModal}
            theme={theme}
          />
        )}
      </main>

      {/* Modal - 加寬為 max-w-5xl */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
          <div className={`absolute inset-0 backdrop-blur-sm cursor-pointer transition-colors duration-300 ${theme === 'dark' ? 'bg-black/80' : 'bg-black/60'}`} onClick={() => setIsModalOpen(false)}></div>
          <div className={`relative w-full max-w-5xl max-h-[90vh] overflow-y-auto rounded-none shadow-2xl flex flex-col md:flex-row transition-colors duration-300 ${theme === 'dark' ? 'bg-[#141414]' : 'bg-white'}`}>
            <button onClick={() => setIsModalOpen(false)} className={`absolute top-4 right-4 z-10 w-8 h-8 rounded-none flex items-center justify-center transition-colors border-none ${theme === 'dark' ? 'bg-[#222] text-gray-500 hover:bg-white hover:text-black' : 'bg-gray-100 text-gray-500 hover:bg-black hover:text-white'}`}>✕</button>

            {isModalLoading ? (
              <div className={`w-full p-32 text-center font-mono text-sm flex flex-col items-center ${theme === 'dark' ? 'text-gray-500' : 'text-gray-400'}`}>
                <svg className={`animate-spin h-8 w-8 mb-4 ${theme === 'dark' ? 'text-white' : 'text-black'}`} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                Fetching data...
              </div>
            ) : modalData && (
              <>
                <div className={`w-full md:w-[30%] p-8 flex flex-col items-center border-r transition-colors duration-300 ${theme === 'dark' ? 'bg-[#0f0f0f] border-[#222]' : 'bg-gray-50 border-gray-100'}`}>
                  <img src={modalData.imageUrl} alt="poster" className={`w-full max-w-[220px] rounded-[12px] shadow-md mb-6 transition-colors duration-300 ${theme === 'dark' ? 'bg-gray-800' : 'bg-gray-200'}`} />
                  
                  {(() => {
                    const inPlaylist = myPlaylist.find(item => item.id === modalData.id);
                    
                    if (inPlaylist && inPlaylist.status === LIST_STATUS.WATCHING) {
                      return (
                        <div className="w-full mb-6">
                          <div className={`text-center py-2 font-bold text-sm border-b flex justify-between px-4 transition-colors duration-300 ${theme === 'dark' ? 'bg-[#141414] text-gray-200 border-[#222]' : 'bg-white text-gray-800 border-gray-100'}`}>
                            <span>進度 ({inPlaylist.watched} / {modalData.eps || '?'})</span>
                            <span className={`font-medium ${theme === 'dark' ? 'text-white' : 'text-black'}`}>觀看中</span>
                          </div>
                          <div className={`p-3 flex gap-2 overflow-x-auto scrollbar-hide transition-colors duration-300 ${theme === 'dark' ? 'bg-[#141414]' : 'bg-white'}`}>
                            {Array.from({ length: modalData.eps || 12 }, (_, i) => i + 1).map(ep => (
                              <button
                                key={ep}
                                onClick={() => handleUpdateProgress(modalData.id, ep)}
                                className={`flex-none w-8 h-8 rounded-none text-xs font-bold transition-all border-none ${
                                  ep <= inPlaylist.watched 
                                    ? (theme === 'dark' ? 'bg-white text-black' : 'bg-black text-white') 
                                    : (theme === 'dark' ? 'bg-[#222] text-gray-400 hover:bg-[#333]' : 'bg-gray-50 text-gray-400 hover:bg-gray-200')
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
                          <div className={`flex w-full h-[44px] rounded-[4px] overflow-hidden shadow-sm transition-colors duration-300 ${theme === 'dark' ? 'bg-white text-black' : 'bg-black text-white'}`}>
                            <button 
                              className={`flex-1 font-medium text-[16px] transition-colors flex items-center justify-center tracking-wide border-none bg-transparent ${theme === 'dark' ? 'hover:bg-gray-200 text-black' : 'hover:bg-gray-800 text-white'}`}
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
                            <div className={`w-[1px] ${theme === 'dark' ? 'bg-black/20' : 'bg-white/20'}`}></div>
                            <button 
                              className={`w-12 flex items-center justify-center transition-colors border-none bg-transparent ${theme === 'dark' ? 'hover:bg-gray-200 text-black' : 'hover:bg-gray-800 text-white'}`}
                              onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                            >
                              <svg className={`w-5 h-5 transition-transform ${isDropdownOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M19 9l-7 7-7-7"></path></svg>
                            </button>
                          </div>

                          {isDropdownOpen && (
                            <div className={`absolute top-[48px] left-0 w-full border shadow-xl z-50 flex flex-col rounded-[4px] transition-colors duration-300 ${theme === 'dark' ? 'bg-[#1a1a1a] border-[#333]' : 'bg-white border-gray-200'}`}>
                              <button 
                                onClick={() => handleAddToList(modalData, LIST_STATUS.WATCHING)}
                                className={`w-full text-left px-5 py-3 text-[15px] font-medium border-b border-none transition-colors ${theme === 'dark' ? 'text-gray-300 hover:bg-[#222] hover:text-white border-[#333]' : 'text-[#556376] hover:bg-gray-50 hover:text-black border-gray-100'}`}
                              >
                                Set as Watching
                              </button>
                              <button 
                                onClick={() => handleAddToList(modalData, LIST_STATUS.PLANNED)}
                                className={`w-full text-left px-5 py-3 text-[15px] font-medium border-b border-none transition-colors ${theme === 'dark' ? 'text-gray-300 hover:bg-[#222] hover:text-white border-[#333]' : 'text-[#556376] hover:bg-gray-50 hover:text-black border-gray-100'}`}
                              >
                                Set as Planning
                              </button>
                              <button 
                                onClick={() => handleAddToList(modalData, LIST_STATUS.COMPLETED)}
                                className={`w-full text-left px-5 py-3 text-[15px] font-medium border-none transition-colors ${theme === 'dark' ? 'text-gray-300 hover:bg-[#222] hover:text-white' : 'text-[#556376] hover:bg-gray-50 hover:text-black'}`}
                              >
                                Set as Completed
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    }
                  })()}
                  
                  <div className={`w-full space-y-3 text-sm font-medium mt-auto transition-colors duration-300 ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>
                    <div className={`flex justify-between pb-2 border-b ${theme === 'dark' ? 'border-[#333]' : 'border-gray-200'}`}>
                      <span>評分</span>
                      <span className={`flex items-center gap-1 ${theme === 'dark' ? 'text-white' : 'text-black'}`}>
                        {sparkleIcon && <img src={sparkleIcon} className={`w-3.5 h-3.5 object-contain transition-all duration-300 ${theme === 'dark' ? 'invert' : ''}`} alt="star" />} 
                        {modalData.score}
                      </span>
                    </div>
                    <div className={`flex justify-between pb-2 border-b ${theme === 'dark' ? 'border-[#333]' : 'border-gray-200'}`}><span>人氣</span><span className={theme === 'dark' ? 'text-white' : 'text-black'}>{modalData.users ? modalData.users.toLocaleString() : '0'}</span></div>
                    <div className={`flex justify-between pb-2 border-b ${theme === 'dark' ? 'border-[#333]' : 'border-gray-200'}`}><span>總集數</span><span className={theme === 'dark' ? 'text-white' : 'text-black'}>{modalData.eps || '?'} 集</span></div>
                    <div className={`flex justify-between pb-2 border-b ${theme === 'dark' ? 'border-[#333]' : 'border-gray-200'}`}><span>放送日期</span><span className={theme === 'dark' ? 'text-white' : 'text-black'}>{modalData.airDateStr}</span></div>
                  </div>
                </div>

                <div className={`w-full md:w-[70%] p-8 md:p-10 overflow-y-auto max-h-[90vh] transition-colors duration-300 ${theme === 'dark' ? 'bg-[#141414]' : 'bg-white'}`}>
                  <div className="mb-8">
                    <div className="flex items-center gap-2 mb-2">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-none tracking-wider ${
                        modalData.status === 'Currently Airing' 
                          ? (theme === 'dark' ? 'bg-[#dbe6ff] text-black' : 'bg-black text-[#dfe9ff]') 
                          : (modalData.status === 'Finished Airing' 
                              ? (theme === 'dark' ? 'bg-[#BDC0BA] text-black' : 'bg-black text-[#BDC0BA]') 
                              : (modalData.status === 'Upcoming'
                                  ? (theme === 'dark' ? 'bg-[#E8F5BD] text-black' : 'bg-black text-[#E8F5BD]')
                                  : (theme === 'dark' ? 'bg-white text-black' : 'bg-black text-white')))
                      }`}>{modalData.status}</span>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-none ${theme === 'dark' ? 'bg-[#222] text-gray-300' : 'bg-gray-100 text-gray-600'}`}>{modalData.format}</span>
                    </div>
                    <h2 className={`text-3xl font-black mb-1 leading-tight ${theme === 'dark' ? 'text-white' : 'text-black'}`}>{modalData.title}</h2>
                    <p className={`text-sm mb-6 font-mono ${theme === 'dark' ? 'text-gray-500' : 'text-gray-400'}`}>{modalData.originalName}</p>
                    
                    <h3 className={`text-sm font-bold mb-2 uppercase tracking-wider ${theme === 'dark' ? 'text-white' : 'text-black'}`}>Synopsis</h3>
                    <p className={`text-sm leading-relaxed whitespace-pre-wrap ${theme === 'dark' ? 'text-gray-300' : 'text-gray-600'}`}>{modalData.synopsis}</p>
                  </div>

                  {modalData.characters && modalData.characters.length > 0 && (
                    <div className={`mt-8 border-t pt-8 ${theme === 'dark' ? 'border-[#333]' : 'border-gray-100'}`}>
                      <h3 className={`text-sm font-bold mb-4 uppercase tracking-wider ${theme === 'dark' ? 'text-white' : 'text-black'}`}>Characters</h3>
                      {/* 修改為 grid-cols-3，並縮小整體區塊 padding */}
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        {modalData.characters.map(char => (
                          <div key={char.id} className={`p-2 flex items-center gap-2 rounded-none transition-colors border-none ${theme === 'dark' ? 'bg-[#1a1a1a]' : 'bg-gray-50'}`}>
                            {/* 縮小頭像為 w-8 h-8 */}
                            {char.image ? <img src={char.image} alt={char.name} className="w-8 h-8 rounded-none object-cover shrink-0" /> : <div className={`w-8 h-8 rounded-none shrink-0 ${theme === 'dark' ? 'bg-gray-800' : 'bg-gray-200'}`}></div>}
                            <div className="overflow-hidden">
                              {/* 縮小文字 */}
                              <p className={`text-xs font-bold truncate ${theme === 'dark' ? 'text-gray-100' : 'text-gray-900'}`}>{char.name}</p>
                              <p className="text-[10px] text-gray-500 truncate">CV: {char.actorName}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Trailer 區塊 */}
                  {modalData.trailer && (
                    <div className={`mt-8 border-t pt-8 ${theme === 'dark' ? 'border-[#333]' : 'border-gray-100'}`}>
                      <div className="flex justify-between items-center mb-4">
                        <h3 className={`text-sm font-bold uppercase tracking-wider ${theme === 'dark' ? 'text-white' : 'text-black'}`}>Trailer</h3>
                        {modalData.trailerRaw?.site?.toLowerCase() === 'youtube' && (
                          <a 
                            href={`https://www.youtube.com/watch?v=${modalData.trailerRaw.id}`} 
                            target="_blank" 
                            rel="noopener noreferrer" 
                            className={`text-xs font-bold transition-colors flex items-center gap-1 ${theme === 'dark' ? 'text-gray-400 hover:text-white' : 'text-gray-500 hover:text-black'}`}
                          >
                            YouTube 觀看 <span className="font-sans text-[10px]">↗</span>
                          </a>
                        )}
                      </div>
                      
                      {modalData.trailerRaw?.thumbnail ? (
                        <a 
                          href={modalData.trailerRaw?.site?.toLowerCase() === 'youtube' ? `https://www.youtube.com/watch?v=${modalData.trailerRaw.id}` : modalData.trailer}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="block w-full aspect-video rounded-[12px] shadow-md bg-[#111] relative overflow-hidden cursor-pointer group"
                        >
                          <img 
                            src={modalData.trailerRaw.thumbnail} 
                            alt={`${modalData.title} Trailer`} 
                            className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105" 
                          />
                        </a>
                      ) : (
                        <a 
                          href={modalData.trailerRaw?.site?.toLowerCase() === 'youtube' ? `https://www.youtube.com/watch?v=${modalData.trailerRaw.id}` : modalData.trailer}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={`flex items-center justify-center w-full aspect-video rounded-[12px] shadow-md border-2 border-dashed transition-colors ${theme === 'dark' ? 'border-[#333] hover:border-gray-500 bg-[#111]' : 'border-gray-200 hover:border-gray-400 bg-gray-50'}`}
                        >
                          <div className={`flex items-center gap-2 font-bold ${theme === 'dark' ? 'text-white' : 'text-black'}`}>
                             <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                             Watch Trailer
                          </div>
                        </a>
                      )}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {currentPage === 'home' && !isModalOpen && (
        <FooterMarquee playlist={myPlaylist} theme={theme} />
      )}

      <style dangerouslySetInnerHTML={{__html: `
        @import url('https://fonts.googleapis.com/css2?family=Fascinate&display=swap');
        .fascinate-regular {
          font-family: "Fascinate", system-ui;
          font-weight: 400;
          font-style: normal;
        }
        body { margin: 0; padding: 0; background-color: ${theme === 'dark' ? '#0a0a0a' : '#ffffff'}; border: none; transition: background-color 0.3s ease; }
        *, *:focus { outline: none !important; }
        .scrollbar-hide::-webkit-scrollbar { display: none; }
        .scrollbar-hide { -ms-overflow-style: none; scrollbar-width: none; }
        @keyframes scroll { 0% { transform: translateX(0); } 100% { transform: translateX(-50%); } }
        @keyframes fade-in-down {
          0% { opacity: 0; transform: translateY(-10px); }
          100% { opacity: 1; transform: translateY(0); }
        }
        @keyframes blink { 0%, 100% { opacity: 1; } 50% { opacity: 0; } }
        .animate-fade-in-down { animation: fade-in-down 0.3s ease-out forwards; }
      `}} />
    </div>
  );
}

function FooterMarquee({ playlist, theme }) {
  const watchingList = playlist.filter(item => item.status === LIST_STATUS.WATCHING);
  const repeatCount = watchingList.length > 0 ? Math.max(4, Math.ceil(20 / watchingList.length)) : 20;

  return (
    <div className={`fixed bottom-0 left-0 w-full h-10 flex items-center overflow-hidden z-50 pointer-events-none border-none transition-colors duration-300 ${theme === 'dark' ? 'bg-[#0a0a0a]' : 'bg-white'}`}>
      <div className="flex whitespace-nowrap animate-[scroll_240s_linear_infinite] text-[11px] font-mono text-gray-500 font-bold items-center pointer-events-auto">
        {[...Array(repeatCount)].map((_, i) => (
          <React.Fragment key={i}>
            {anilistLogoWhite && <img src={theme === 'dark' ? anilistLogoWhite : anilistLogo} alt="AniList Logo" className="mx-6 w-[18px] h-[18px] object-cover rounded-[4px] shrink-0 transition-all duration-300" />}
            <span className={`mx-6 tracking-widest uppercase shrink-0 ${theme === 'dark' ? 'text-white' : 'text-black'}`}>Currently Watching</span>
            {watchingList.length > 0 ? (
              watchingList.map((anime, idx) => (
                <span key={`${anime.id}-${i}-${idx}`} className={`mx-6 cursor-pointer transition-colors shrink-0 ${theme === 'dark' ? 'hover:text-gray-300 text-white' : 'hover:text-black text-black'}`}>
                  {anime.title}
                </span>
              ))
            ) : (
              <span className={`mx-6 cursor-pointer transition-colors shrink-0 ${theme === 'dark' ? 'hover:text-gray-300 text-gray-500' : 'hover:text-black text-gray-400'}`}>None</span>
            )}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}

function HomeView({ allSeasonAnime, currentSeasonInfo, onAdd, onOpenModal, isLoading, setCurrentPage, theme }) {
  const currentJS = new Date().getDay(); 
  const currentDayIndex = currentJS === 0 ? 6 : currentJS - 1; 
  const [activeTab, setActiveTab] = useState(currentDayIndex);
  
  /* 精準判斷 1920px (將您的筆電 1800px 歸類在 3 欄，大外接螢幕 2560px 歸類在 4 欄) */
  const [itemsPerRow, setItemsPerRow] = useState(() => typeof window !== 'undefined' && window.innerWidth >= 1920 ? 4 : 3);
  
  useEffect(() => {
    const handleResize = () => setItemsPerRow(window.innerWidth >= 1920 ? 4 : 3);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const schedule = useMemo(() => {
    const daysZh = ['一', '二', '三', '四', '五', '六', '日'];
    const map = Array.from({ length: 7 }, (_, i) => ({ id: i, name: `周${daysZh[i]}`, items: [] }));
    const other = { id: 7, name: '其他', items: [] }; 
    
    allSeasonAnime.forEach(anime => {
        if (anime.broadcastDayIndex !== null && anime.broadcastDayIndex >= 0 && anime.broadcastDayIndex <= 6) {
            map[anime.broadcastDayIndex].items.push(anime);
        } else {
            other.items.push(anime);
        }
    });
    if (other.items.length > 0) map.push(other);
    return map;
  }, [allSeasonAnime]);

  const currentList = schedule.find(s => s.id === activeTab)?.items || [];

  const rows = useMemo(() => {
    const result = [];
    for (let i = 0; i < currentList.length; i += itemsPerRow) {
      result.push(currentList.slice(i, i + itemsPerRow));
    }
    return result;
  }, [currentList, itemsPerRow]);

  return (
    <div className={`flex flex-col lg:flex-row h-full overflow-hidden relative pb-8 items-start transition-colors duration-300 ${theme === 'dark' ? 'bg-[#0a0a0a]' : 'bg-white'}`}>
      
      {/* 天花板 padding：小於 1920px (筆電) 是 12vh，大螢幕 1920px 以上恢復 18vh */}
      <div className="w-full lg:w-[35%] h-full flex flex-col px-8 lg:pl-8 lg:pr-8 shrink-0 overflow-y-auto pt-[12vh] min-[1920px]:pt-[18vh]">
        <div className="w-full max-w-[480px] ml-auto flex flex-col h-full pb-[10vh]">
          
          <p className={`text-[15px] font-medium mb-12 flex items-center gap-2 transition-colors duration-300 ${theme === 'dark' ? 'text-white' : 'text-black'}`}>
            Powered by AniList GraphQL API <span className="font-sans">↗</span>
          </p>
          
          <h1 className={`text-[4.5rem] min-[1920px]:text-[5.5rem] tracking-tight mb-10 fascinate-regular leading-none transition-colors duration-300 ${theme === 'dark' ? 'text-white' : 'text-black'}`}>
            Willy List
          </h1>
          
          <p className={`text-[16px] leading-relaxed mb-16 font-medium transition-colors duration-300 ${theme === 'dark' ? 'text-white' : 'text-black'}`}>
            Willy List is an unofficial & open-source platform for the 
            <br/><strong>"most active online anime community and database"</strong>.
          </p>

          <div className={`grid grid-cols-1 md:grid-cols-2 gap-y-8 gap-x-6 text-[15px] font-medium transition-colors duration-300 ${theme === 'dark' ? 'text-white' : 'text-black'}`}>
            <div className="flex items-center gap-3">
              {codeIcon && <img src={codeIcon} alt="API" className={`w-5 h-5 object-contain transition-all duration-300 ${theme === 'dark' ? 'invert' : ''}`} />}
              GraphQL API
            </div>
            <a href="https://anilist.co/" target="_blank" rel="noopener noreferrer" className={`flex items-center gap-3 hover:opacity-70 transition-opacity no-underline ${theme === 'dark' ? 'text-white' : 'text-black'}`}>
              {anilistIcon && <img src={anilistIcon} alt="AniList" className={`w-5 h-5 object-contain transition-all duration-300 ${theme === 'dark' ? 'invert' : ''}`} />}
              AniList
            </a>
            <a href="https://github.com/ck8g7yfyhh-bit/anime-tracker/tree/main" target="_blank" rel="noopener noreferrer" className={`flex items-center gap-3 hover:opacity-70 transition-opacity no-underline ${theme === 'dark' ? 'text-white' : 'text-black'}`}>
              {developerIcon && <img src={developerIcon} alt="GitHub" className={`w-5 h-5 object-contain transition-all duration-300 ${theme === 'dark' ? 'invert' : ''}`} />}
              GitHub
            </a>
            <a href="https://www.notion.so/Anime-2e1d8b733d024f98a2767ae4209e525b?di=182b0c4e59934b4e853f90c1898138e7" target="_blank" rel="noopener noreferrer" className={`flex items-center gap-3 hover:opacity-70 transition-opacity no-underline ${theme === 'dark' ? 'text-white' : 'text-black'}`}>
              {notionIcon && <img src={notionIcon} alt="Notion" className={`w-5 h-5 object-contain transition-all duration-300 ${theme === 'dark' ? 'invert' : ''}`} />}
              Willy-Anime
            </a>
          </div>

          {/* 移除了原本的 Learn more 和 Get started 按鈕 */}
        </div>
      </div>

      <div className="w-full lg:w-[65%] h-full flex flex-col relative overflow-hidden">
        
        {/* 天花板 padding：小於 1920px (筆電) 是 12vh，大螢幕 1920px 以上恢復 18vh */}
        <div className={`shrink-0 w-full pt-[12vh] min-[1920px]:pt-[18vh] pb-6 px-8 flex flex-col items-start gap-6 z-10 transition-colors duration-300 ${theme === 'dark' ? 'bg-[#0a0a0a]' : 'bg-white'}`}>
          <div className={`flex items-center gap-3 text-sm font-mono w-fit ${theme === 'dark' ? 'text-white' : 'text-black'}`}>
            <span className="font-black tracking-wide">GET</span>
            <span className="font-medium truncate flex items-center">
              https://anilist.co/api/v2/oauth/pin
            </span>
          </div>

          {!isLoading && allSeasonAnime.length > 0 && (
            <div className="flex gap-8 overflow-x-auto scrollbar-hide w-full justify-start mt-2">
              {schedule.map((day) => (
                <span 
                  key={day.id} 
                  onClick={() => setActiveTab(day.id)} 
                  className={`text-[15px] cursor-pointer transition-colors whitespace-nowrap font-bold uppercase tracking-wider ${activeTab === day.id ? (theme === 'dark' ? 'text-white border-b-[3px] border-white pb-1.5' : 'text-black border-b-[3px] border-black pb-1.5') : (theme === 'dark' ? 'text-gray-400 hover:text-white pb-1.5' : 'text-gray-400 hover:text-black pb-1.5')}`}
                >
                  {day.name.replace('周', '')} {day.id === currentDayIndex && <span className="text-[10px] opacity-70 ml-1">(今日)</span>}
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto overflow-x-auto scrollbar-hide px-8 pb-24">
          {isLoading ? (
            <div className={`w-full flex flex-col items-center justify-center space-y-4 py-20 ${theme === 'dark' ? 'text-gray-500' : 'text-gray-400'}`}>
              <svg className={`animate-spin h-8 w-8 ${theme === 'dark' ? 'text-white' : 'text-black'}`} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
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
                    // 卡片寬度在筆電加大到 320px，並且加上 flex 讓它強制等高拉伸
                    <div key={anime.id} className="w-[320px] min-[1920px]:w-[360px] shrink-0 flex">
                      <AnimeCardHome 
                        anime={anime} 
                        onAdd={() => onAdd(anime, LIST_STATUS.PLANNED)} 
                        onClick={() => onOpenModal(anime)} 
                        theme={theme}
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
    </div>
  );
}

function AnimeCardHome({ anime, onClick, onAdd, theme }) {
  const displayDate = anime.season && anime.year 
    ? `${anime.season} ${anime.year}` 
    : (anime.year ? anime.year : (anime.airDateStr ? anime.airDateStr.split('-')[0] : ''));

  return (
    // 這裡加上 h-full 確保同一行的卡片高度都能等比例對齊，不會因為標題字數不同而大小不一
    <div className={`flex gap-5 p-3.5 cursor-pointer relative group transition-all hover:shadow-md rounded-2xl border w-full h-full ${theme === 'dark' ? 'bg-[#141414] border-transparent hover:border-[#333]' : 'bg-white border-transparent hover:border-gray-100'}`} onClick={onClick}>
      {/* 海報大小切換：小於 1920px 給筆電較小尺寸，外接大螢幕 1920px 給大尺寸 */}
      <img src={anime.imageUrl} alt={anime.title} className={`object-cover rounded-[12px] shrink-0 shadow-sm transition-transform group-hover:scale-[1.02] w-[85px] h-[125px] min-[1920px]:w-[105px] min-[1920px]:h-[155px] ${theme === 'dark' ? 'bg-[#222]' : 'bg-gray-100'}`} />
      <div className="flex flex-col flex-1 py-1 min-w-0">
        
        <div className={`font-medium mb-1 tracking-wide text-[10px] min-[1920px]:text-[11px] ${anime.status === 'Currently Airing' ? (theme === 'dark' ? 'text-[#dbe6ff]' : 'text-[#dfe9ff]') : (anime.status === 'Finished Airing' ? 'text-[#BDC0BA]' : (anime.status === 'Upcoming' ? 'text-[#E8F5BD]' : (theme === 'dark' ? 'text-gray-600' : 'text-gray-400')))}`}>
          {anime.status}
        </div>
        
        <div className={`font-medium mb-1.5 flex items-center gap-2 text-[11px] min-[1920px]:text-[12px] ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}`}>
          {displayDate && <span>{displayDate}</span>}
          {anime.eps && <span>• {anime.eps} eps</span>}
        </div>
        
        {/* 標題大小切換 */}
        <h3 className={`font-bold leading-tight line-clamp-2 pr-2 mb-2.5 text-[14px] min-[1920px]:text-[16px] ${theme === 'dark' ? 'text-white' : 'text-black'}`}>
          {anime.title}
        </h3>
        
        <div className="flex items-center gap-5 mb-2 mt-auto">
          <div className="flex flex-col">
            <span className={`font-bold leading-none mb-1 flex items-center gap-1.5 text-[13px] min-[1920px]:text-[14px] ${theme === 'dark' ? 'text-white' : 'text-black'}`}>
              {sparkleIcon && <img src={sparkleIcon} className={`w-3.5 h-3.5 object-contain transition-all duration-300 ${theme === 'dark' ? 'invert' : ''}`} alt="star" />} 
              {anime.score}
            </span>
            <span className={`text-[#BDC0BA] font-medium leading-none text-[9px] min-[1920px]:text-[10px]`}>{anime.users ? (anime.users/1000).toFixed(0)+'k' : '0'} users</span>
          </div>
        </div>
        
        <div className="flex flex-wrap gap-1 mt-1">
          {anime.tags?.slice(0, 2).map(tag => (
            <span key={tag} className={`font-bold px-0 rounded-none truncate max-w-[70px] text-[9px] min-[1920px]:text-[10px] ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>
              {translateGenre(tag) || tag}
            </span>
          ))}
        </div>
      </div>

      <button onClick={(e) => { e.stopPropagation(); onAdd(anime); }} className={`absolute bottom-3 right-3 w-[34px] h-[34px] text-lg rounded-full opacity-0 group-hover:opacity-100 transition-all flex items-center justify-center font-bold hover:scale-110 shadow-md border-none ${theme === 'dark' ? 'bg-white text-black' : 'bg-black text-white'}`} title="加入待播清單">
        +
      </button>
    </div>
  );
}

function AnimeCardHorizontal({ anime, onClick, onAdd, theme }) {
  const displayDate = anime.season && anime.year 
    ? `${anime.season} ${anime.year}` 
    : (anime.year ? anime.year : (anime.airDateStr ? anime.airDateStr.split('-')[0] : ''));

  return (
    // 這裡同樣補上 h-full
    <div className={`flex gap-4 p-3 cursor-pointer relative group transition-all hover:shadow-lg rounded-2xl border w-full h-full ${theme === 'dark' ? 'bg-[#141414] border-transparent hover:border-[#333]' : 'bg-white border-transparent hover:border-gray-100'}`} onClick={onClick}>
      <img src={anime.imageUrl} alt={anime.title} className={`w-[85px] h-[125px] object-cover rounded-[12px] shrink-0 shadow-sm transition-transform group-hover:scale-[1.02] ${theme === 'dark' ? 'bg-[#222]' : 'bg-gray-100'}`} />
      <div className="flex flex-col flex-1 py-1 min-w-0">
        
        <div className={`text-[10px] font-bold mb-1 tracking-wide ${anime.status === 'Currently Airing' ? (theme === 'dark' ? 'text-[#dbe6ff]' : 'text-[#dfe9ff]') : (anime.status === 'Finished Airing' ? 'text-[#BDC0BA]' : (anime.status === 'Upcoming' ? 'text-[#E8F5BD]' : (theme === 'dark' ? 'text-gray-600' : 'text-gray-400')))}`}>
          {anime.status}
        </div>
        
        <div className={`text-[11px] font-bold mb-1 flex items-center gap-2 ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}`}>
          {displayDate && <span>{displayDate}</span>}
          {anime.eps && <span>• {anime.eps} eps</span>}
        </div>
        
        <h3 className={`text-[14px] font-bold leading-tight line-clamp-2 pr-2 mb-2 ${theme === 'dark' ? 'text-white' : 'text-black'}`}>
          {anime.title}
        </h3>
        
        <div className="flex items-center gap-4 mb-2 mt-auto">
          <div className="flex flex-col">
            <span className={`text-[13px] font-bold leading-none mb-1 flex items-center gap-1 ${theme === 'dark' ? 'text-white' : 'text-black'}`}>
              {sparkleIcon && <img src={sparkleIcon} className={`w-3 h-3 object-contain transition-all duration-300 ${theme === 'dark' ? 'invert' : ''}`} alt="star" />} 
              {anime.score}
            </span>
            <span className={`text-[9px] text-[#BDC0BA] font-medium leading-none`}>{anime.users ? (anime.users/1000).toFixed(0)+'k' : '0'} users</span>
          </div>
        </div>
        
        <div className="flex flex-wrap gap-1 mt-1">
          {anime.tags?.slice(0, 2).map(tag => (
            <span key={tag} className={`text-[9px] font-bold px-0 rounded-none truncate max-w-[60px] ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>
              {translateGenre(tag) || tag}
            </span>
          ))}
        </div>
      </div>

      <button onClick={(e) => { e.stopPropagation(); onAdd(anime); }} className={`absolute bottom-3 right-3 w-7 h-7 rounded-full opacity-0 group-hover:opacity-100 transition-all flex items-center justify-center font-bold hover:scale-110 shadow-md border-none ${theme === 'dark' ? 'bg-white text-black' : 'bg-black text-white'}`} title="加入待播清單">
        +
      </button>
    </div>
  );
}

function CatalogView({ searchQuery, onAdd, onOpenModal, theme }) {
  const FORMATS = [
    { id: '全部', label: 'All' },
    { id: 'TV', label: 'TV' },
    { id: 'ONA', label: 'ONA' },
    { id: 'OVA', label: 'OVA' },
    { id: 'MOVIE', label: 'MOVIE' }
  ];
  
  const [activeFormat, setActiveFormat] = useState('全部'); 
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
      
      const cacheKey = JSON.stringify({ searchQuery, activeFormat, activeGenre, activeSort, activeYear, activeSeason, activeStatus, currentPage });
      
      if (globalApiCache.has(cacheKey)) {
          const cachedData = globalApiCache.get(cacheKey);
          if (isMounted) {
            setData(cachedData.formatted);
            setTotalPages(cachedData.totalPages);
            setIsLoading(false);
          }
          return;
      }

      try {
        let variables = { page: currentPage, sort: [activeSort] };
        
        if (searchQuery) variables.search = searchQuery;
        if (activeFormat !== '全部') variables.format = activeFormat;
        
        if (activeGenre !== '全部') {
          variables.genre = activeGenre;
        }
        
        if (activeYear === '即將上映') variables.status = 'NOT_YET_RELEASED';
        else if (activeYear !== '全部' && activeYear !== '2000以前') {
           variables.seasonYear = parseInt(activeYear);
           if (activeSeason !== '全部') variables.season = activeSeason.toUpperCase();
        }
        
        if (activeStatus !== '全部' && activeYear !== '即將上映') {
            if (activeStatus === 'RELEASING') variables.status = 'RELEASING';
            else if (activeStatus === 'FINISHED') variables.status = 'FINISHED';
            else if (activeStatus === 'UPCOMING') variables.status = 'NOT_YET_RELEASED';
        }

        const query = `
          query($page: Int, $search: String, $format: MediaFormat, $genre: String, $status: MediaStatus, $seasonYear: Int, $season: MediaSeason, $sort: [MediaSort]) {
            Page(page: $page, perPage: 24) {
              pageInfo { lastPage }
              media(search: $search, format: $format, genre: $genre, status: $status, seasonYear: $seasonYear, season: $season, type: ANIME, countryOfOrigin: "JP", sort: $sort, isAdult: false) {
                id title { romaji english native } coverImage { large } meanScore popularity episodes status format genres season seasonYear description nextAiringEpisode { airingAt } startDate { year month day } isAdult
              }
            }
          }
        `;

        const resData = await fetchAniList(query, variables);
        
        if (isMounted && resData.Page) {
          const formatted = (resData.Page.media || []).map(formatAnilistAnime);
          const totalP = resData.Page.pageInfo?.lastPage || 1;
          
          globalApiCache.set(cacheKey, { formatted, totalPages: totalP });
          
          setData(formatted);
          setTotalPages(totalP);
        }
      } catch (error) {
        console.error(error);
        if(isMounted) {
            setData([]);
            setApiError(error.message.includes('Client Error') ? "沒有找到符合條件的動漫。" : "系統發生錯誤，請稍後再試。");
        }
      } finally {
        if (isMounted) setIsLoading(false);
      }
    };
    
    const timeoutId = setTimeout(fetchFilteredData, 400);
    return () => { isMounted = false; clearTimeout(timeoutId); };
  }, [searchQuery, activeGenre, activeSort, activeYear, activeSeason, activeFormat, activeStatus, currentPage]);

  const hasNextPage = currentPage < totalPages;

  return (
    <div className={`h-full overflow-y-auto px-6 lg:px-16 py-10 pb-24 scrollbar-hide transition-colors duration-300 ${theme === 'dark' ? 'bg-[#0a0a0a]' : 'bg-white'}`}>
      <div className="max-w-[1600px] mx-auto">
        <h1 className={`text-3xl mb-6 fascinate-regular transition-colors duration-300 ${theme === 'dark' ? 'text-white' : 'text-black'}`}>
          Explore
          {searchQuery && <span className={`text-lg font-sans ml-4 ${theme === 'dark' ? 'text-gray-500' : 'text-gray-400'}`}>/ Search: "{searchQuery}"</span>}
        </h1>
        
        <div className={`flex p-1 rounded-none w-fit mb-8 transition-colors duration-300 ${theme === 'dark' ? 'bg-[#1a1a1a]' : 'bg-gray-100'}`}>
          {FORMATS.map(f => (
            <button
              key={f.id}
              onClick={() => { setActiveFormat(f.id); setCurrentPage(1); }}
              className={`px-8 py-2.5 text-sm font-bold transition-all rounded-none border-none ${activeFormat === f.id ? (theme === 'dark' ? 'bg-white text-black shadow-sm' : 'bg-black text-white shadow-sm') : `bg-transparent text-gray-500 ${theme === 'dark' ? 'hover:text-white' : 'hover:text-black'}`}`}
            >
              {f.label}
            </button>
          ))}
        </div>
        
        <div className="flex flex-col mb-10">
          <div className="flex flex-col gap-6 w-full">
            
            <div className="flex items-center gap-6 overflow-x-auto scrollbar-hide">
              <span className={`text-xs font-bold uppercase tracking-wider shrink-0 w-12 transition-colors duration-300 ${theme === 'dark' ? 'text-white' : 'text-black'}`}>Status</span>
              <div className="flex gap-2 w-max">
                {['全部', 'RELEASING', 'FINISHED', 'UPCOMING'].map(s => (
                  <button 
                    key={`status-${s}`} 
                    onClick={() => { setActiveStatus(s); setCurrentPage(1); }} 
                    className={`shrink-0 px-4 py-1.5 rounded-none border-none text-xs font-bold transition-all whitespace-nowrap ${activeStatus === s ? (theme === 'dark' ? 'bg-white text-black' : 'bg-black text-white') : `${theme === 'dark' ? 'bg-[#1a1a1a] hover:bg-[#333]' : 'bg-gray-100 hover:bg-gray-200'} text-gray-500`}`}>
                    {s === '全部' ? '全部' : s === 'RELEASING' ? '連載中' : s === 'FINISHED' ? '已完結' : '即將上映'}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-6 overflow-x-auto scrollbar-hide">
              <span className={`text-xs font-bold uppercase tracking-wider shrink-0 w-12 transition-colors duration-300 ${theme === 'dark' ? 'text-white' : 'text-black'}`}>Genre</span>
              <div className="flex gap-2 w-max">
                {UI_GENRES.map(g => (
                  <button 
                    key={`genre-${g}`} 
                    onClick={() => { setActiveGenre(g); setCurrentPage(1); }} 
                    className={`shrink-0 px-4 py-1.5 rounded-none border-none text-xs font-bold transition-all whitespace-nowrap ${activeGenre === g ? (theme === 'dark' ? 'bg-white text-black' : 'bg-black text-white') : `${theme === 'dark' ? 'bg-[#1a1a1a] hover:bg-[#333]' : 'bg-gray-100 hover:bg-gray-200'} text-gray-500`}`}>
                    {translateGenre(g) || g}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-6 overflow-x-auto scrollbar-hide">
              <span className={`text-xs font-bold uppercase tracking-wider shrink-0 w-12 transition-colors duration-300 ${theme === 'dark' ? 'text-white' : 'text-black'}`}>Year</span>
              <div className="flex gap-2 w-max">
                {UI_YEARS.map(y => (
                  <button 
                    key={`year-${y}`} 
                    onClick={() => { 
                      setActiveYear(y); 
                      setCurrentPage(1);
                      if (y === '全部' || y === '2000以前' || y === '即將上映') setActiveSeason('全部'); 
                    }} 
                    className={`shrink-0 px-4 py-1.5 rounded-none border-none text-xs font-bold transition-all whitespace-nowrap ${activeYear === y ? (theme === 'dark' ? 'bg-white text-black' : 'bg-black text-white') : `${theme === 'dark' ? 'bg-[#1a1a1a] hover:bg-[#333]' : 'bg-gray-100 hover:bg-gray-200'} text-gray-500`}`}>
                    {y}
                  </button>
                ))}
              </div>
            </div>

            <div className={`flex items-center gap-6 overflow-x-auto scrollbar-hide transition-opacity ${['全部', '2000以前', '即將上映'].includes(activeYear) ? 'opacity-20 pointer-events-none' : ''}`}>
              <span className={`text-xs font-bold uppercase tracking-wider shrink-0 w-12 transition-colors duration-300 ${theme === 'dark' ? 'text-white' : 'text-black'}`}>Season</span>
              <div className="flex gap-2 w-max">
                {UI_SEASONS.map(s => (
                  <button 
                    key={`season-${s}`} 
                    onClick={() => { setActiveSeason(s); setCurrentPage(1); }} 
                    className={`shrink-0 px-4 py-1.5 rounded-none border-none text-xs font-bold transition-all whitespace-nowrap ${activeSeason === s ? (theme === 'dark' ? 'bg-white text-black' : 'bg-black text-white') : `${theme === 'dark' ? 'bg-[#1a1a1a] hover:bg-[#333]' : 'bg-gray-100 hover:bg-gray-200'} text-gray-500`}`}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
          </div>
          
          <div className="flex justify-end pt-6 mt-4">
            <div className="flex items-center gap-3 shrink-0">
              <span className={`text-[10px] font-bold uppercase tracking-wider ${theme === 'dark' ? 'text-gray-500' : 'text-gray-400'}`}>Sort by</span>
              <button onClick={() => { setActiveSort('SCORE_DESC'); setCurrentPage(1); }} className={`text-xs font-bold transition-colors border-none bg-transparent p-0 ${activeSort === 'SCORE_DESC' ? (theme === 'dark' ? 'text-white' : 'text-black') : (theme === 'dark' ? 'text-gray-500 hover:text-gray-300' : 'text-gray-400 hover:text-gray-600')}`}>Top Rated</button>
              <span className={theme === 'dark' ? 'text-gray-700' : 'text-gray-200'}>/</span>
              <button onClick={() => { setActiveSort('POPULARITY_DESC'); setCurrentPage(1); }} className={`text-xs font-bold transition-colors border-none bg-transparent p-0 ${activeSort === 'POPULARITY_DESC' ? (theme === 'dark' ? 'text-white' : 'text-black') : (theme === 'dark' ? 'text-gray-500 hover:text-gray-300' : 'text-gray-400 hover:text-gray-600')}`}>Trending Now</button>
              <span className={theme === 'dark' ? 'text-gray-700' : 'text-gray-200'}>/</span>
              <button onClick={() => { setActiveSort('START_DATE_DESC'); setCurrentPage(1); }} className={`text-xs font-bold transition-colors border-none bg-transparent p-0 ${activeSort === 'START_DATE_DESC' ? (theme === 'dark' ? 'text-white' : 'text-black') : (theme === 'dark' ? 'text-gray-500 hover:text-gray-300' : 'text-gray-400 hover:text-gray-600')}`}>Latest</button>
            </div>
          </div>
        </div>

        {isLoading ? (
          <div className={`text-center py-32 font-mono text-sm flex flex-col items-center ${theme === 'dark' ? 'text-gray-500' : 'text-gray-400'}`}>
            <svg className={`animate-spin h-6 w-6 mb-4 ${theme === 'dark' ? 'text-white' : 'text-black'}`} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
            Querying AniList GraphQL API...
          </div>
        ) : apiError ? (
          <div className={`text-center py-32 border border-dashed rounded-none text-sm transition-colors duration-300 ${theme === 'dark' ? 'bg-[#111] border-[#222] text-gray-500' : 'bg-gray-50 border-gray-100 text-gray-400'}`}>
            {apiError}
          </div>
        ) : data.length === 0 ? (
          <div className={`text-center py-32 border border-dashed rounded-none text-sm transition-colors duration-300 ${theme === 'dark' ? 'bg-[#111] border-[#222] text-gray-500' : 'bg-gray-50 border-gray-100 text-gray-400'}`}>
            找不到符合條件的動畫，請嘗試其他篩選組合。
          </div>
        ) : (
          <>
            {/* 保留 4 欄的設定 */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-10 w-full mx-auto">
              {data.map((anime) => (
                <div key={`cat-${anime.id}`} className="w-full">
                  <AnimeCardHorizontal anime={anime} onAdd={() => onAdd(anime, LIST_STATUS.PLANNED)} onClick={() => onOpenModal(anime)} theme={theme} />
                </div>
              ))}
            </div>
            
            <div className={`flex justify-center items-center gap-4 pt-4 border-t mt-8 transition-colors duration-300 ${theme === 'dark' ? 'border-[#222]' : 'border-gray-100'}`}>
              <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1} className={`px-6 py-2 text-sm font-bold transition-all rounded-none border-none ${theme === 'dark' ? 'text-white disabled:text-gray-600 bg-[#1a1a1a] hover:bg-[#333]' : 'text-black disabled:text-gray-300 bg-gray-100 hover:bg-gray-200'}`}>PREV</button>
              <span className={`text-sm font-mono font-bold px-4 py-1.5 transition-colors duration-300 ${theme === 'dark' ? 'text-white' : 'text-black'}`}>
                {currentPage === totalPages ? `Page ${currentPage} / ${totalPages}` : `Page ${currentPage}`}
              </span>
              <button onClick={() => setCurrentPage(p => p + 1)} disabled={!hasNextPage} className={`px-6 py-2 text-sm font-bold transition-all rounded-none border-none ${theme === 'dark' ? 'text-white disabled:text-gray-600 bg-[#1a1a1a] hover:bg-[#333]' : 'text-black disabled:text-gray-300 bg-gray-100 hover:bg-gray-200'}`}>NEXT</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function ProfileView({ playlist, onUpdateProgress, onChangeStatus, onRemove, onOpenModal, theme }) {
  const [activeTab, setActiveTab] = useState(LIST_STATUS.WATCHING);
  const [sortOrder, setSortOrder] = useState('newest'); 
  const [activeFormat, setActiveFormat] = useState('全部'); 

  const tabs = [
    { id: LIST_STATUS.WATCHING, label: 'Watching' },
    { id: LIST_STATUS.PLANNED, label: 'Plan to Watch' },
    { id: LIST_STATUS.COMPLETED, label: 'Completed' }
  ];
  
  const FORMATS = ['全部', 'TV', 'ONA', 'MOVIE'];

  const currentList = playlist.filter(item => {
    if (activeTab === LIST_STATUS.WATCHING) {
      return item.status === activeTab;
    } else {
      return item.status === activeTab && (activeFormat === '全部' || item.format === activeFormat);
    }
  });

  const sortedList = useMemo(() => {
    let list = [...currentList];
    if (activeTab === LIST_STATUS.PLANNED || activeTab === LIST_STATUS.COMPLETED) {
      list.sort((a, b) => {
        const getScore = (anime) => {
          let year = parseInt(anime.year) || 0;
          if (year === 0 && anime.airDateStr) {
             const match = anime.airDateStr.match(/\d{4}/);
             if (match) year = parseInt(match[0]);
          }
          let seasonVal = 0;
          if (anime.season) {
             const s = anime.season.toLowerCase();
             if (s === 'winter') seasonVal = 1;
             else if (s === 'spring') seasonVal = 2;
             else if (s === 'summer') seasonVal = 3;
             else if (s === 'fall') seasonVal = 4;
          }
          return year * 10 + seasonVal; 
        };

        const scoreA = getScore(a);
        const scoreB = getScore(b);

        if (scoreA === 0 && scoreB !== 0) return 1; 
        if (scoreB === 0 && scoreA !== 0) return -1;

        if (sortOrder === 'newest') return scoreB - scoreA;
        return scoreA - scoreB;
      });
    }
    return list;
  }, [currentList, activeTab, sortOrder]);

  return (
    <div className={`h-full overflow-y-auto px-6 lg:px-16 py-10 pb-24 scrollbar-hide transition-colors duration-300 ${theme === 'dark' ? 'bg-[#0a0a0a]' : 'bg-white'}`}>
      <div className="max-w-[1600px] mx-auto">
        <div className={`flex items-center justify-between border-b pb-8 mb-8 transition-colors duration-300 ${theme === 'dark' ? 'border-[#222]' : 'border-gray-100'}`}>
          <div>
            <h1 className={`text-3xl mb-2 fascinate-regular transition-colors duration-300 ${theme === 'dark' ? 'text-white' : 'text-black'}`}>My Profile</h1>
            <p className={`text-sm transition-colors duration-300 ${theme === 'dark' ? 'text-gray-500' : 'text-gray-400'}`}>
              Tracked: {playlist.length} | Completed: {playlist.filter(i => i.status === LIST_STATUS.COMPLETED).length}
            </p>
          </div>
          <div className={`w-16 h-16 flex items-center justify-center text-2xl font-bold font-mono rounded-none transition-colors duration-300 ${theme === 'dark' ? 'bg-white text-black' : 'bg-black text-white'}`}>
            M
          </div>
        </div>

        <div className={`flex flex-col xl:flex-row justify-between xl:items-end gap-6 mb-10 border-b pb-2 transition-colors duration-300 ${theme === 'dark' ? 'border-[#1a1a1a]' : 'border-gray-50'}`}>
          <div className="flex gap-8 overflow-x-auto scrollbar-hide shrink-0">
            {tabs.map(tab => (
              <button key={tab.id} onClick={() => { setActiveTab(tab.id); setActiveFormat('全部'); }} className={`pb-2 text-sm font-bold transition-colors border-none bg-transparent relative shrink-0 ${activeTab === tab.id ? (theme === 'dark' ? 'text-white' : 'text-black') : (theme === 'dark' ? 'text-gray-500 hover:text-white' : 'text-gray-400 hover:text-black')}`}>
                {tab.label}
                <span className={`ml-2 text-[10px] px-2 py-0.5 rounded-none transition-colors duration-300 ${activeTab === tab.id ? (theme === 'dark' ? 'bg-white text-black' : 'bg-black text-white') : (theme === 'dark' ? 'bg-[#1a1a1a] text-gray-400' : 'bg-gray-100 text-gray-500')}`}>
                    {activeTab === LIST_STATUS.WATCHING ? playlist.filter(i => i.status === tab.id).length : playlist.filter(i => i.status === tab.id && (activeFormat === '全部' || i.format === activeFormat)).length}
                </span>
                {activeTab === tab.id && <div className={`absolute -bottom-2 left-0 w-full h-0.5 transition-colors duration-300 ${theme === 'dark' ? 'bg-white' : 'bg-black'}`}></div>}
              </button>
            ))}
          </div>

          {(activeTab === LIST_STATUS.PLANNED || activeTab === LIST_STATUS.COMPLETED) && (
            <div className="flex flex-wrap items-center gap-4 xl:gap-6 mb-2">
                <div className="flex items-center gap-3 overflow-x-auto scrollbar-hide">
                  <span className={`text-[10px] font-bold uppercase tracking-wider shrink-0 ${theme === 'dark' ? 'text-gray-500' : 'text-gray-400'}`}>Format</span>
                  {FORMATS.map(f => (
                    <button 
                      key={f} 
                      onClick={() => setActiveFormat(f)} 
                      className={`text-xs font-bold transition-colors border-none bg-transparent p-0 whitespace-nowrap ${activeFormat === f ? (theme === 'dark' ? 'text-white' : 'text-black') : (theme === 'dark' ? 'text-gray-500 hover:text-gray-300' : 'text-gray-400 hover:text-gray-600')}`}
                    >
                      {f}
                    </button>
                  )).reduce((prev, curr, i) => [prev, <span key={`sep-fmt-${i}`} className={theme === 'dark' ? 'text-gray-700 shrink-0' : 'text-gray-200 shrink-0'}>/</span>, curr])}
                </div>
                
                <div className={`hidden xl:block w-[1px] h-3 ${theme === 'dark' ? 'bg-gray-700' : 'bg-gray-200'}`}></div>

                <div className="flex items-center gap-3 shrink-0">
                    <span className={`text-[10px] font-bold uppercase tracking-wider ${theme === 'dark' ? 'text-gray-500' : 'text-gray-400'}`}>Date</span>
                    <button onClick={() => setSortOrder('newest')} className={`text-xs font-bold transition-colors border-none bg-transparent p-0 ${sortOrder === 'newest' ? (theme === 'dark' ? 'text-white' : 'text-black') : (theme === 'dark' ? 'text-gray-500 hover:text-gray-300' : 'text-gray-400 hover:text-gray-600')}`}>Newest</button>
                    <span className={theme === 'dark' ? 'text-gray-700' : 'text-gray-200'}>/</span>
                    <button onClick={() => setSortOrder('oldest')} className={`text-xs font-bold transition-colors border-none bg-transparent p-0 ${sortOrder === 'oldest' ? (theme === 'dark' ? 'text-white' : 'text-black') : (theme === 'dark' ? 'text-gray-500 hover:text-gray-300' : 'text-gray-400 hover:text-gray-600')}`}>Oldest</button>
                </div>
            </div>
          )}
        </div>

        {sortedList.length === 0 ? (
          <div className={`text-center py-24 border border-dashed text-sm font-mono rounded-none transition-colors duration-300 ${theme === 'dark' ? 'bg-[#111] border-[#222] text-gray-500' : 'bg-gray-50 border-gray-100 text-gray-400'}`}>
            List is empty.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 w-full mx-auto">
            {sortedList.map(anime => {
               const isWatching = activeTab === LIST_STATUS.WATCHING;

               return (
                <div key={`profile-${anime.id}`} className={`p-4 flex gap-4 relative group transition-all border rounded-2xl ${theme === 'dark' ? 'bg-[#141414] border-transparent hover:border-[#333]' : 'bg-white border-gray-50 hover:border-gray-200'}`}>
                  <img src={anime.imageUrl} alt="poster" className={`w-[90px] h-[130px] object-cover rounded-[12px] cursor-pointer shrink-0 shadow-sm hover:scale-[1.02] transition-transform ${theme === 'dark' ? 'bg-[#222]' : 'bg-gray-100'}`} onClick={() => onOpenModal(anime)} />
                  <div className="flex-1 flex flex-col min-w-0">
                    
                    {!isWatching && (
                      <div className={`text-[10px] font-bold mb-1.5 tracking-wide ${anime.status === 'Currently Airing' ? (theme === 'dark' ? 'text-[#dbe6ff]' : 'text-[#dfe9ff]') : (anime.status === 'Finished Airing' ? 'text-[#BDC0BA]' : (anime.status === 'Upcoming' ? 'text-[#E8F5BD]' : (theme === 'dark' ? 'text-gray-600' : 'text-gray-400')))}`}>
                        {anime.status}
                      </div>
                    )}
                    
                    <h3 className={`font-bold text-[14px] truncate cursor-pointer hover:underline ${!isWatching ? 'mb-2' : 'mb-1'} ${theme === 'dark' ? 'text-white' : 'text-black'}`} onClick={() => onOpenModal(anime)}>{anime.title}</h3>
                    
                    {isWatching ? (
                      <p className={`text-[10px] font-mono mb-4 ${theme === 'dark' ? 'text-gray-500' : 'text-gray-400'}`}>Total: {anime.eps || '?'} eps</p>
                    ) : (
                      <div className={`text-[11px] font-bold mb-1 flex items-center gap-2 ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}`}>
                        {anime.season || anime.year ? <span>{anime.season} {anime.year}</span> : null}
                        <span className="flex items-center gap-1">
                          {sparkleIcon && <img src={sparkleIcon} className={`w-3 h-3 object-contain transition-all duration-300 ${theme === 'dark' ? 'invert' : ''}`} alt="star" />}
                          {anime.score}
                        </span>
                      </div>
                    )}
                    
                    <div className="mt-auto">
                      {isWatching && (
                        <>
                          <div className={`flex justify-between items-center text-[10px] mb-2 font-bold uppercase tracking-wider ${theme === 'dark' ? 'text-gray-500' : 'text-gray-400'}`}>
                            <span>Progress</span>
                            <span className={theme === 'dark' ? 'text-white' : 'text-black'}>{anime.watched} / {anime.eps || '?'}</span>
                          </div>
                          <div className={`w-full rounded-none h-1.5 mb-4 overflow-hidden transition-colors duration-300 ${theme === 'dark' ? 'bg-[#222]' : 'bg-gray-100'}`}>
                            <div className={`h-full transition-all ${theme === 'dark' ? 'bg-white' : 'bg-black'}`} style={{ width: `${Math.min(100, (anime.watched / (anime.eps || 12)) * 100)}%` }}></div>
                          </div>
                        </>
                      )}
                      
                      <div className={`flex justify-end gap-1.5 ${!isWatching ? 'mt-auto' : 'mt-2'}`}>
                        {isWatching && (
                          <button onClick={() => onUpdateProgress(anime.id, anime.watched + 1)} className={`px-2 py-1.5 rounded-none text-[9px] font-bold transition-colors border-none bg-transparent shrink-0 ${theme === 'dark' ? 'text-gray-500 hover:text-white' : 'text-gray-400 hover:text-black'}`}>1 EP</button>
                        )}
                        {anime.status === LIST_STATUS.PLANNED && (
                          <>
                            <button onClick={() => onChangeStatus(anime.id, LIST_STATUS.WATCHING)} className={`px-2 py-1.5 rounded-none text-[9px] font-bold transition-colors border-none bg-transparent shrink-0 ${theme === 'dark' ? 'text-gray-500 hover:text-white' : 'text-gray-400 hover:text-black'}`}>Watching</button>
                            <button onClick={() => onChangeStatus(anime.id, LIST_STATUS.COMPLETED)} className={`px-2 py-1.5 rounded-none text-[9px] font-bold transition-colors border-none bg-transparent shrink-0 ${theme === 'dark' ? 'text-gray-500 hover:text-white' : 'text-gray-400 hover:text-black'}`}>Completed</button>
                          </>
                        )}
                        <button onClick={() => onRemove(anime.id)} className={`px-2 py-1.5 rounded-none text-[9px] font-bold transition-colors border-none bg-transparent shrink-0 ${theme === 'dark' ? 'text-gray-500 hover:text-[#F75C2F]' : 'text-gray-400 hover:text-[#F75C2F]'}`}>Remove</button>
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

function CheckIcon({className}) {
  return <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7"></path></svg>;
}