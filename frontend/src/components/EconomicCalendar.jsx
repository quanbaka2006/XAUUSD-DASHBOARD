import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { 
  Calendar, 
  Clock, 
  Sliders, 
  Newspaper, 
  RefreshCw, 
  Search, 
  AlertTriangle, 
  ArrowRight,
  Flame,
  Globe,
  Star,
  Sparkles,
  Info
} from 'lucide-react';
import { useTradeStore } from '../store/useTradeStore';
import { useTranslation } from '../utils/translations';

// Helper to format Date object into YYYY-MM-DD
const formatDateToYYYYMMDD = (d) => {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

// Helper to get current week's Monday and Sunday dates
const getThisWeekRange = () => {
  const now = new Date();
  const day = now.getDay();
  // Monday is 1, Sunday is 0. If Sunday (0), go back 6 days to Monday.
  const diffToMonday = now.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(now.setDate(diffToMonday));
  
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  
  return {
    start: formatDateToYYYYMMDD(monday),
    end: formatDateToYYYYMMDD(sunday)
  };
};

export function EconomicCalendar() {
  const { t, language } = useTranslation();
  const {
    calendarEvents,
    calendarLoading,
    wallstreetNews,
    newsLoading,
    fetchCalendarForDateRange,
    fetchNews
  } = useTradeStore();

  const weekRange = useMemo(() => getThisWeekRange(), []);

  // Filter States
  const [dateMode, setDateMode] = useState('week'); // 'week' or 'custom'
  const [startDate, setStartDate] = useState(weekRange.start);
  const [endDate, setEndDate] = useState(weekRange.end);
  const [minImpact, setMinImpact] = useState('all'); // 'all', '1', '2', '3'
  const [searchQuery, setSearchQuery] = useState('');
  
  // News States
  const [newsOnlyImportant, setNewsOnlyImportant] = useState(false);
  const [newsCountdown, setNewsCountdown] = useState(30);

  // Load calendar when dates change
  useEffect(() => {
    fetchCalendarForDateRange(startDate, endDate);
  }, [startDate, endDate, fetchCalendarForDateRange]);

  // Load news and set up polling
  const loadNews = useCallback(() => {
    fetchNews(40, 0, newsOnlyImportant);
    setNewsCountdown(30);
  }, [fetchNews, newsOnlyImportant]);

  useEffect(() => {
    loadNews();
  }, [loadNews]);

  // News auto-refresh countdown
  useEffect(() => {
    const timer = setInterval(() => {
      setNewsCountdown(prev => {
        if (prev <= 1) {
          loadNews();
          return 30;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [loadNews]);

  // Preset Handlers
  const handleSelectThisWeek = () => {
    setDateMode('week');
    setStartDate(weekRange.start);
    setEndDate(weekRange.end);
  };

  const handleSelectToday = () => {
    setDateMode('custom');
    const today = formatDateToYYYYMMDD(new Date());
    setStartDate(today);
    setEndDate(today);
  };

  const handleSelectNextWeek = () => {
    setDateMode('custom');
    const now = new Date();
    const day = now.getDay();
    const diffToMonday = now.getDate() - day + (day === 0 ? -6 : 1);
    
    const nextMonday = new Date();
    nextMonday.setDate(diffToMonday + 7);
    const nextSunday = new Date(nextMonday);
    nextSunday.setDate(nextMonday.getDate() + 6);
    
    setStartDate(formatDateToYYYYMMDD(nextMonday));
    setEndDate(formatDateToYYYYMMDD(nextSunday));
  };

  // Filter and Search events logic
  const filteredEvents = useMemo(() => {
    if (!calendarEvents) return [];
    return calendarEvents.filter(ev => {
      // 1. Filter by search query
      const title = (ev.events_translate || ev.events || '').toLowerCase();
      const country = (ev.country_translate || ev.country || '').toLowerCase();
      const currency = (ev.currency || '').toLowerCase();
      const matchesSearch = searchQuery === '' || 
        title.includes(searchQuery.toLowerCase()) ||
        country.includes(searchQuery.toLowerCase()) ||
        currency.includes(searchQuery.toLowerCase());

      // 2. Filter by impact level
      const evStar = parseInt(ev.star) || 1;
      let matchesImpact = true;
      if (minImpact === '3') {
        matchesImpact = evStar === 3;
      } else if (minImpact === '2') {
        matchesImpact = evStar >= 2;
      } else if (minImpact === '1') {
        matchesImpact = evStar >= 1;
      }

      return matchesSearch && matchesImpact;
    });
  }, [calendarEvents, searchQuery, minImpact]);

  // Helper to parse date from various timestamp formats
  const parseDate = useCallback((val) => {
    if (!val) return new Date();
    return new Date(typeof val === 'number' || /^\d{10,}$/.test(val) ? Number(val) : val);
  }, []);

  // Format timestamp helper to HH:MM:SS
  const formatNewsTime = useCallback((timestamp) => {
    if (!timestamp) return '--:--:--';
    const d = parseDate(timestamp);
    if (isNaN(d.getTime())) return '--:--:--';
    return d.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
  }, [parseDate]);

  // Group news by date for rendering with separators
  const groupedNews = useMemo(() => {
    if (!wallstreetNews) return {};
    const groups = {};
    wallstreetNews.forEach(news => {
      const createTimeRaw = news.createtime || news.createTime;
      const d = parseDate(createTimeRaw);
      
      let dateLabel = '';
      if (isNaN(d.getTime())) {
        dateLabel = t('unknownDate');
      } else {
        const today = new Date();
        if (d.getDate() === today.getDate() && d.getMonth() === today.getMonth() && d.getFullYear() === today.getFullYear()) {
          dateLabel = t('today');
        } else {
          dateLabel = d.toLocaleDateString(language === 'en' ? 'en-US' : 'vi-VN', { day: "2-digit", month: "2-digit" });
        }
      }
      
      if (!groups[dateLabel]) {
        groups[dateLabel] = [];
      }
      groups[dateLabel].push(news);
    });
    return groups;
  }, [wallstreetNews, parseDate]);

  const formatEventDate = (dateStr) => {
    if (!dateStr) return '';
    try {
      const d = new Date(dateStr.replace(/-/g, '/'));
      return d.toLocaleDateString(language === 'en' ? 'en-US' : 'vi-VN', { weekday: 'long', day: '2-digit', month: '2-digit' });
    } catch {
      return dateStr;
    }
  };

  // Group events by date for elegant layout
  const groupedEvents = useMemo(() => {
    const groups = {};
    filteredEvents.forEach(ev => {
      // Extract date YYYY-MM-DD from pub_time_tz (format: '2026-06-17 03:30:00')
      const datePart = ev.pub_time_tz ? ev.pub_time_tz.split(' ')[0] : t('unknownDate');
      if (!groups[datePart]) {
        groups[datePart] = [];
      }
      groups[datePart].push(ev);
    });
    return groups;
  }, [filteredEvents, t]);

  return (
    <div className="w-full flex flex-col gap-6 text-slate-100 font-sans z-10 relative">
      
      {/* HEADER SECTION */}
      <div className="panel-primary flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 p-6 rounded-2xl relative overflow-hidden">
        <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-amber-500/20 to-transparent" />
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-500">
            <Calendar className="h-5 w-5" />
          </div>
          <div className="text-left">
            <span className="text-xs font-black text-amber-500 uppercase tracking-widest block">{t('economicCalendar').toUpperCase()}</span>
            <h2 className="text-xl font-black text-white uppercase mt-0.5 tracking-tight">{t('macroCalendarTitle')}</h2>
          </div>
        </div>
        <p className="text-xs text-slate-400 max-w-md text-left sm:text-right font-medium leading-relaxed">
          {t('macroCalendarDesc')}
        </p>
      </div>

      {/* BODY LAYOUT GRID */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        
        {/* COLUMN 1: Economic Calendar (70% - lg:col-span-8) */}
        <div className="lg:col-span-8 flex flex-col gap-6">
          
          {/* Card: Calendar Filters & Controls */}
          <div className="space-panel-heavy p-6 rounded-2xl relative">
            <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-amber-500/35 to-transparent" />
            <h3 className="text-xs font-black text-white uppercase tracking-wider mb-4 flex items-center gap-2">
              <Sliders className="h-4 w-4 text-amber-500" />
              {t('calendarFilters')}
            </h3>

            <div className="flex flex-col gap-4">
              
              {/* Presets and Mode selectors */}
              <div className="flex flex-wrap gap-2.5 items-center">
                <button
                  onClick={handleSelectThisWeek}
                  className={`px-4 py-2 rounded-xl text-xs font-bold transition-all border cursor-pointer ${
                    dateMode === 'week'
                      ? 'bg-amber-500 border-amber-500 text-slate-950 font-black shadow-[0_0_15px_rgba(234,179,8,0.2)]'
                      : 'bg-white/[0.04] border-white/[0.08] text-slate-400 hover:text-white hover:border-white/[0.16]'
                  }`}
                >
                  {t('thisWeek')}
                </button>
                <button
                  onClick={handleSelectToday}
                  className={`px-4 py-2 rounded-xl text-xs font-bold transition-all border cursor-pointer ${
                    dateMode === 'custom' && startDate === formatDateToYYYYMMDD(new Date()) && endDate === formatDateToYYYYMMDD(new Date())
                      ? 'bg-amber-500 border-amber-500 text-slate-950 font-black shadow-[0_0_15px_rgba(234,179,8,0.2)]'
                      : 'bg-white/[0.04] border-white/[0.08] text-slate-400 hover:text-white hover:border-white/[0.16]'
                  }`}
                >
                  {t('today')}
                </button>
                <button
                  onClick={handleSelectNextWeek}
                  className={`px-4 py-2 rounded-xl text-xs font-bold transition-all border cursor-pointer ${
                    startDate === weekRange.start && endDate === weekRange.end ? 'bg-slate-900/50 border-slate-800 text-slate-400 hover:text-white hover:border-slate-700' : 
                    (new Date(startDate).getTime() > new Date(weekRange.end).getTime() ? 'bg-amber-500 border-amber-500 text-slate-950 font-black shadow-[0_0_15px_rgba(234,179,8,0.2)]' : 'bg-white/[0.04] border-white/[0.08] text-slate-400 hover:text-white hover:border-white/[0.16]')
                  }`}
                >
                  {t('nextWeek')}
                </button>
              </div>

              {/* Date Inputs & Text Search & Star Level Filters */}
              <div className="grid grid-cols-1 sm:grid-cols-12 gap-4 border-t border-white/[0.06] pt-4">
                
                {/* Start Date */}
                <div className="sm:col-span-3 space-y-1">
                  <label className="text-[11px] font-bold text-slate-500 uppercase tracking-widest block text-left">{t('fromDate')}</label>
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => {
                      setDateMode('custom');
                      setStartDate(e.target.value);
                    }}
                    className="w-full bg-white/[0.04] border border-white/[0.08] hover:border-white/[0.14] focus:border-amber-500/50 rounded-xl px-3 py-2 text-xs font-semibold text-white focus:outline-none transition-colors"
                  />
                </div>

                {/* End Date */}
                <div className="sm:col-span-3 space-y-1">
                  <label className="text-[11px] font-bold text-slate-500 uppercase tracking-widest block text-left">{t('toDate')}</label>
                  <input
                    type="date"
                    value={endDate}
                    onChange={(e) => {
                      setDateMode('custom');
                      setEndDate(e.target.value);
                    }}
                    className="w-full bg-white/[0.04] border border-white/[0.08] hover:border-white/[0.14] focus:border-amber-500/50 rounded-xl px-3 py-2 text-xs font-semibold text-white focus:outline-none transition-colors"
                  />
                </div>

                {/* Star level */}
                <div className="sm:col-span-3 space-y-1">
                  <label className="text-[11px] font-bold text-slate-500 uppercase tracking-widest block text-left">{t('impactLevel')}</label>
                  <select
                    value={minImpact}
                    onChange={(e) => setMinImpact(e.target.value)}
                    className="w-full bg-white/[0.04] border border-white/[0.08] hover:border-white/[0.14] focus:border-amber-500/50 rounded-xl px-3 py-2 text-xs font-bold text-white focus:outline-none transition-colors cursor-pointer"
                  >
                    <option value="all">{t('allImpacts')}</option>
                    <option value="3">{t('highImpactOnly')}</option>
                    <option value="2">{t('mediumHighImpact')}</option>
                    <option value="1">{t('lowImpactAbove')}</option>
                  </select>
                </div>

                {/* Search */}
                <div className="sm:col-span-3 space-y-1">
                  <label className="text-[11px] font-bold text-slate-500 uppercase tracking-widest block text-left">{t('searchEvents')}</label>
                  <div className="relative">
                    <input
                      type="text"
                      placeholder={t('searchPlaceholder')}
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full bg-white/[0.04] border border-white/[0.08] hover:border-white/[0.14] focus:border-amber-500/50 rounded-xl pl-9 pr-3 py-2 text-xs font-semibold text-white placeholder-slate-600 focus:outline-none transition-colors"
                    />
                    <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-600" />
                  </div>
                </div>

              </div>

            </div>
          </div>

          {/* Card: Economic Events List */}
          <div className="space-panel-heavy p-6 rounded-2xl text-left">
            
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-sm font-black text-white uppercase tracking-wider flex items-center gap-2">
                <Globe className="h-4 w-4 text-amber-500" />
                {t('macroEventsList')} ({filteredEvents.length})
              </h3>
              {dateMode === 'week' && (
                <span className="text-xs font-black text-amber-500 uppercase tracking-widest bg-amber-500/10 border border-amber-500/20 px-2.5 py-1 rounded-md">
                  {t('currentWeekLabel')}
                </span>
              )}
            </div>

            {calendarLoading ? (
              // Loading skeletons
              <div className="space-y-6">
                {[1, 2, 3].map(i => (
                  <div key={i} className="space-y-3">
                    <div className="h-4 w-32 bg-white/[0.05] rounded animate-pulse" />
                    <div className="border border-white/[0.05] rounded-xl p-4 space-y-3">
                      <div className="flex justify-between">
                        <div className="h-3 w-1/3 bg-white/[0.05] rounded animate-pulse" />
                        <div className="h-3 w-16 bg-white/[0.05] rounded animate-pulse" />
                      </div>
                      <div className="h-4 w-1/2 bg-white/[0.05] rounded animate-pulse" />
                    </div>
                  </div>
                ))}
              </div>
            ) : filteredEvents.length === 0 ? (
              <div className="py-16 text-center border border-dashed border-white/[0.08] rounded-xl text-slate-500 text-xs font-bold bg-white/[0.02]">
                {t('noEventsFound')}
              </div>
            ) : (
              <div className="space-y-6">
                {Object.entries(groupedEvents).sort((a,b) => a[0].localeCompare(b[0])).map(([dateStr, events]) => (
                  <div key={dateStr} className="space-y-2.5">
                    {/* Group Header Date */}
                    <div className="text-xs font-black text-sky-400/80 uppercase tracking-widest border-l-2 border-sky-500 pl-2 py-0.5">
                      {formatEventDate(dateStr)} ({dateStr})
                    </div>
                    
                    {/* Events in this date */}
                    <div className="flex flex-col gap-2.5">
                      {events.map((ev) => {
                        const starNum = parseInt(ev.star) || 1;
                        let impactColor = 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-400';
                        let impactText = t('impactLow');
                        
                        if (starNum === 3) {
                          impactColor = 'bg-red-500/15 border border-red-500/25 text-red-400 animate-pulse';
                          impactText = t('impactHigh');
                        } else if (starNum === 2) {
                          impactColor = 'bg-amber-500/10 border border-amber-500/20 text-amber-400';
                          impactText = t('impactMedium');
                        }

                        return (
                          <div 
                            key={ev.id || ev.events_id} 
                            className="bg-white/[0.02] hover:bg-white/[0.04] border border-white/[0.06] hover:border-white/[0.10] rounded-xl p-4 transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-4 group"
                          >
                            {/* Left part: Time, Currency, Country, Title */}
                            <div className="flex items-start gap-3.5 flex-1 text-left">
                              <div className="h-10 w-10 rounded-xl bg-white/[0.04] border border-white/[0.08] flex flex-col items-center justify-center min-w-[40px]">
                                <Clock className="h-3 w-3 text-slate-500" />
                                <span className="text-xs font-mono font-bold text-slate-300 mt-0.5">{ev.events_time || ev.pub_time || '---'}</span>
                              </div>
                              
                              <div className="space-y-1">
                                <div className="flex flex-wrap items-center gap-2">
                                  {ev.country_flag && (
                                    <img 
                                      src={ev.country_flag} 
                                      alt={ev.country_translate} 
                                      className="h-3 w-4 rounded-sm object-cover"
                                      onError={(e) => { e.target.style.display = 'none'; }}
                                    />
                                  )}
                                  <span className="text-[11px] font-black text-slate-400 uppercase tracking-wide">
                                    {ev.country_translate || ev.country} • {ev.currency}
                                  </span>
                                  <span className={`px-2 py-0.5 rounded text-[11px] font-black uppercase tracking-wider ${impactColor}`}>
                                    {impactText}
                                  </span>
                                </div>
                                <h4 className="text-xs font-black text-slate-200 group-hover:text-white transition-colors leading-relaxed">
                                  {ev.events_translate || ev.events}
                                </h4>
                              </div>
                            </div>

                            {/* Right part: Economic values */}
                            <div className="flex items-center gap-6 justify-between sm:justify-end border-t sm:border-t-0 border-white/[0.06] pt-2 sm:pt-0 font-mono text-xs font-bold">
                              
                              <div className="text-center">
                                <span className="text-xs font-black text-slate-500 uppercase tracking-wider block mb-0.5">{t('previousValue')}</span>
                                <span className={ev.previous && ev.previous !== '---' ? "text-slate-300 block" : "text-slate-600 block font-normal"}>
                                  {ev.previous && ev.previous !== '---' ? ev.previous : 'N/A'}
                                </span>
                              </div>

                              <div className="text-center">
                                <span className="text-xs font-black text-slate-500 uppercase tracking-wider block mb-0.5">{t('forecastValue')}</span>
                                <span className={ev.consensus && ev.consensus !== '---' ? "text-slate-300 block" : "text-slate-600 block font-normal"}>
                                  {ev.consensus && ev.consensus !== '---' ? ev.consensus : 'N/A'}
                                </span>
                              </div>

                              <div className="text-center bg-white/[0.04] px-3 py-1.5 rounded-lg border border-white/[0.08] min-w-[70px]">
                                <span className="text-xs font-black text-slate-500 uppercase tracking-wider block mb-0.5">{t('actualValue')}</span>
                                <span className={`block font-black ${(() => {
                                  if (!ev.actual || ev.actual === '---') return 'text-slate-600 font-normal';
                                  
                                  // Parse numbers for comparison
                                  const getNumeric = (val) => {
                                    if (!val || val === '---') return null;
                                    const num = parseFloat(val.replace(/[^0-9.-]/g, ''));
                                    return isNaN(num) ? null : num;
                                  };
                                  
                                  const actNum = getNumeric(ev.actual);
                                  const conNum = getNumeric(ev.consensus);
                                  
                                  if (actNum !== null && conNum !== null) {
                                    const isNegativeIndicator = (title) => {
                                      const t = title.toLowerCase();
                                      return t.includes('unemployment') || t.includes('claim') || t.includes('layoff') || t.includes('thất nghiệp') || t.includes('trợ cấp');
                                    };
                                    const isNeg = isNegativeIndicator(ev.events_translate || ev.events);
                                    const isBetter = isNeg ? actNum < conNum : actNum > conNum;
                                    return isBetter ? 'text-emerald-400' : 'text-red-400';
                                  }
                                  
                                  return ev.actual.includes('-') ? 'text-red-400' : 'text-emerald-400';
                                })()}`}>
                                  {ev.actual && ev.actual !== '---' ? ev.actual : 'N/A'}
                                </span>
                              </div>

                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}

          </div>

        </div>

        {/* COLUMN 2: VnWallStreet Real-time News (30% - lg:col-span-4) */}
        <div className="lg:col-span-4 flex flex-col gap-6">
          
          {/* Card: News Feed */}
          <div className="panel-surface p-6 rounded-2xl flex flex-col text-left h-[800px] overflow-hidden relative">
            <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-amber-500/35 to-transparent" />
            
            <div className="flex justify-between items-center mb-4 border-b border-white/[0.06] pb-3">
              <h3 className="text-xs font-black text-white uppercase tracking-wider flex items-center gap-2">
                <Newspaper className="h-4 w-4 text-amber-500" />
                {t('instantNewsFeed')}
              </h3>
              <div className="flex items-center gap-2.5">
                <span className="text-[11px] font-bold text-slate-500 font-mono">{t('refreshCountdown')}: {newsCountdown}s</span>
                <button
                  onClick={loadNews}
                  disabled={newsLoading}
                  className="p-1.5 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] hover:border-white/[0.16] text-slate-400 hover:text-white transition-all cursor-pointer disabled:opacity-50"
                  title={language === 'en' ? "Reload now" : "Tải lại ngay"}
                >
                  <RefreshCw className={`h-3 w-3 ${newsLoading ? 'animate-spin text-amber-500' : ''}`} />
                </button>
              </div>
            </div>

            {/* News Filter Checkbox */}
            <div className="flex items-center justify-between bg-white/[0.03] border border-white/[0.06] p-2.5 rounded-xl mb-4 text-xs font-bold">
              <span className="text-slate-400 flex items-center gap-1">
                <Info className="h-3 w-3 text-slate-500" />
                {t('filterImportantNews')}
              </span>
              <button
                onClick={() => setNewsOnlyImportant(!newsOnlyImportant)}
                className={`px-2.5 py-1 rounded-lg border font-black transition-all cursor-pointer ${
                  newsOnlyImportant 
                    ? 'bg-amber-500 border-amber-500 text-slate-950'
                    : 'bg-white/[0.04] border-white/[0.08] text-slate-400 hover:text-white'
                }`}
              >
                {newsOnlyImportant ? t('enable') : t('disable')}
              </button>
            </div>

            {/* Scrollable News list */}
            {newsLoading && wallstreetNews.length === 0 ? (
              // Skeletons
              <div className="space-y-4 flex-1 overflow-hidden">
                {[1, 2, 3, 4].map(i => (
                  <div key={i} className="border border-white/[0.05] p-3.5 rounded-xl space-y-2 animate-pulse">
                    <div className="h-3 w-16 bg-white/[0.05] rounded" />
                    <div className="h-3.5 w-full bg-white/[0.05] rounded" />
                    <div className="h-3.5 w-3/4 bg-white/[0.05] rounded" />
                  </div>
                ))}
              </div>
            ) : wallstreetNews.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center text-slate-500 text-xs font-bold py-12 border border-dashed border-white/[0.08] rounded-xl bg-white/[0.02]">
                {t('noNewsFound')}
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto pr-1 space-y-4 custom-scrollbar">
                {Object.entries(groupedNews).map(([dateLabel, items]) => (
                  <div key={dateLabel} className="space-y-2">
                    {/* Date separator header for older news */}
                    {dateLabel !== t('today') && (
                      <div className="flex items-center gap-2 py-1 px-1 text-xs font-black text-sky-400/80 uppercase tracking-widest border-b border-sky-500/20">
                        <span>📅 {language === 'en' ? 'Date' : 'Ngày'} {dateLabel}</span>
                      </div>
                    )}
                    
                    <div className="flex flex-col gap-2.5">
                      {items.map((news, idx) => {
                        const isImportant = news.important === '1' || news.isimportant === true || news.isimportant === 1 || news.influence >= 3;
                        const isHot = news.ishot === 1 || news.ishot === true || news.hot === 1 || news.hot === true;
                        
                        let cardBorder = 'border-slate-800/60 hover:border-slate-700';
                        let accentLine = null;
                        
                        if (isImportant) {
                          cardBorder = 'border-red-500/20 hover:border-red-500/35 bg-red-500/5';
                          accentLine = <div className="absolute top-0 left-0 bottom-0 w-[3px] bg-red-500" />;
                        } else if (isHot) {
                          cardBorder = 'border-amber-500/25 hover:border-amber-500/40 bg-amber-500/5';
                          accentLine = <div className="absolute top-0 left-0 bottom-0 w-[3px] bg-amber-500" />;
                        } else {
                          cardBorder = 'bg-white/[0.02] border-white/[0.06] hover:border-white/[0.12]';
                        }
                        
                        return (
                          <div 
                            key={news.messageid || idx} 
                            onClick={() => window.open(`https://vnwallstreet.org/tin/${news.messageid || news.id || news.messageId}`, '_blank')}
                            className={`p-3.5 rounded-xl border transition-all hover:bg-slate-900/10 text-left relative overflow-hidden cursor-pointer select-none group ${cardBorder}`}
                            title={t('clickToViewOriginal')}
                          >
                            {accentLine}
                            
                            {/* News Header: Time & Badges */}
                            <div className="flex items-center gap-2 mb-1.5 text-xs font-mono font-bold">
                              <span className="text-sky-400 group-hover:text-sky-300 transition-colors">
                                {formatNewsTime(news.createtime || news.createTime)}
                              </span>
                              
                              {isImportant && (
                                <span className="px-1.5 py-0.5 bg-red-500/10 border border-red-500/20 text-red-400 rounded-md uppercase tracking-wider flex items-center gap-0.5 font-sans animate-pulse">
                                  <Flame className="h-2.5 w-2.5 fill-current" />
                                  {t('newsTypeImportant')}
                                </span>
                              )}
                              
                              {isHot && (
                                <span className="px-1.5 py-0.5 bg-amber-500/10 border border-amber-500/20 text-amber-500 rounded-md uppercase tracking-wider flex items-center gap-0.5 font-sans">
                                  <Flame className="h-2.5 w-2.5 fill-current" />
                                  HOT
                                </span>
                              )}
                              
                              {!isImportant && !isHot && (
                                <span className="text-slate-500 group-hover:text-slate-400 transition-colors">{t('newsTypeFlash')}</span>
                              )}
                            </div>

                            {/* News Content */}
                            <p className="text-[11px] font-medium text-slate-300 group-hover:text-white leading-relaxed break-words transition-colors">
                              {news.content}
                            </p>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* News Footer branding */}
            <div className="mt-3 pt-3 border-t border-white/[0.06] flex justify-between items-center text-xs font-bold text-slate-500 uppercase tracking-widest">
              <span>{t('newsSource')}</span>
              <span>{t('newsUpdated')}</span>
            </div>

          </div>

        </div>

      </div>

    </div>
  );
}
