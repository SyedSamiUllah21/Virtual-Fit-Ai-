
import React, { useEffect, useMemo, useState } from 'react';
import { Sparkles, ChevronDown } from 'lucide-react';
import ProductCard from './components/ProductCard';
import StudioView from './components/StudioView';
import { Product, AppView } from './types';
import { MOCK_PRODUCTS, FRONTEND_TO_BACKEND_PRODUCT_ID, BACKEND_TO_FRONTEND_PRODUCT_ID } from './constants';
import { login, register, fetchDashboard, checkout, type User, type BackendProduct } from './services/backendService';

const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<AppView>('login');
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [productHistory, setProductHistory] = useState<Product[]>([]);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [recommendedProducts, setRecommendedProducts] = useState<Product[]>([]);
  const [isLoadingRecommendations, setIsLoadingRecommendations] = useState(false);
  const [recommendationError, setRecommendationError] = useState('');
  const [recommendationRefreshKey, setRecommendationRefreshKey] = useState(0);
  const [hasPurchaseHistory, setHasPurchaseHistory] = useState(false);

  const recRef = React.useRef<HTMLDivElement>(null);
  const [isRecVisible, setIsRecVisible] = useState(false);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setIsRecVisible(true);
        } else {
          setIsRecVisible(false);
        }
      },
      { threshold: 0.1 }
    );
    if (recRef.current) {
      observer.observe(recRef.current);
    }
    return () => observer.disconnect();
  }, [hasPurchaseHistory, recommendedProducts.length, activeTab]);

  const displayProducts = MOCK_PRODUCTS;

  const sectionedProducts = useMemo(() => {
    const upperKeywords = ['jacket', 'shirt', 'sweater', 'tee', 'top', 'blouse'];
    const bottomKeywords = ['jean', 'chino', 'culotte', 'pant', 'trouser', 'skirt', 'short'];

    const isUpper = (name: string) => upperKeywords.some((kw) => name.toLowerCase().includes(kw));
    const isBottom = (name: string) => bottomKeywords.some((kw) => name.toLowerCase().includes(kw));

    const men = displayProducts.filter((p) => p.gender === 'Men');
    const women = displayProducts.filter((p) => p.gender === 'Women');

    return {
      menUppers: men.filter((p) => isUpper(p.name)),
      womenUppers: women.filter((p) => isUpper(p.name)),
      menBottoms: men.filter((p) => isBottom(p.name)),
      womenBottoms: women.filter((p) => isBottom(p.name))
    };
  }, [displayProducts]);

  const handleBuyNow = (product: Product) => {
    setProductHistory([]);  // Clear history when starting fresh from collections
    setSelectedProduct(product);
    setActiveTab('studio');
  };

  const handleSelectRecommendedProduct = (product: Product) => {
    setProductHistory((prev) => selectedProduct ? [...prev, selectedProduct] : prev);
    setSelectedProduct(product);
  };

  const handleGoToPreviousProduct = () => {
    setProductHistory((prev) => {
      const next = [...prev];
      const previous = next.pop();
      if (previous) setSelectedProduct(previous);
      return next;
    });
  };

  const mapDashboardRecommendationsToProducts = (items: BackendProduct[]): Product[] => {
    const mapped = items
      .map((item) => {
        const frontendId = BACKEND_TO_FRONTEND_PRODUCT_ID[item.id];
        if (!frontendId) {
          return null;
        }
        return MOCK_PRODUCTS.find((p) => p.id === frontendId) || null;
      })
      .filter((p): p is Product => Boolean(p));

    const seen = new Set<string>();
    return mapped.filter((p) => {
      if (seen.has(p.id)) return false;
      seen.add(p.id);
      return true;
    });
  };

  const handlePurchaseInStudio = async (product: Product): Promise<void> => {
    if (!currentUser?.user_id) {
      throw new Error('Sign in to save purchases and get recommendations.');
    }

    const backendProductId = FRONTEND_TO_BACKEND_PRODUCT_ID[product.id];
    if (!backendProductId) {
      throw new Error('Could not save this product purchase.');
    }

    const result = await checkout(currentUser.user_id, backendProductId);
    if (!result.success) {
      throw new Error(result.error || 'Purchase could not be saved.');
    }

    setRecommendationRefreshKey((prev) => prev + 1);
  };

  const renderContent = () => {
    if (activeTab === 'studio') {
      return (
        <StudioView 
          product={selectedProduct} 
          onBack={() => { setProductHistory([]); setActiveTab('collections'); }}
          onPurchase={currentUser?.user_id ? handlePurchaseInStudio : undefined}
          onSelectProduct={handleSelectRecommendedProduct}
          previousProduct={productHistory.length > 0 ? productHistory[productHistory.length - 1] : undefined}
          onGoToPrevious={productHistory.length > 0 ? handleGoToPreviousProduct : undefined}
        />
      );
    }

    if (activeTab === 'dashboard' || activeTab === 'collections') {
      return (
        <main className="flex-1 min-h-screen bg-[#f4eadc] flex flex-col animate-in fade-in duration-700">
          
          {/* Hero Section - Elevated Minimalist Art */}
          <div className="w-full min-h-[90vh] flex flex-col items-center justify-center text-center px-6 bg-[#2a2018] text-white overflow-hidden relative">
            
            {/* AESTHETIC MINIMALIST BACKGROUND ART WITH INTERACTIVE ANIMATIONS */}
            {/* Base soft glows */}
            <div className="absolute top-0 right-1/4 w-[800px] h-[800px] bg-[#8a5f3b] rounded-full blur-[160px] opacity-40 pointer-events-none translate-x-1/2 -translate-y-1/3 animate-pulse"></div>
            <div className="absolute bottom-0 left-1/4 w-[600px] h-[600px] bg-[#b29572] rounded-full blur-[150px] opacity-20 pointer-events-none -translate-x-1/2 translate-y-1/3 animate-[pulse_4s_cubic-bezier(0.4,0,0.6,1)_infinite]"></div>
            
            {/* Giant abstract geometric rings with spin animations */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[1400px] h-[1400px] border-[1px] border-[#b29572]/20 rounded-full pointer-events-none animate-[spin_120s_linear_infinite]"></div>
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[900px] h-[900px] border-[1.5px] border-[#5d4631]/30 border-dashed rounded-full pointer-events-none animate-[spin_90s_linear_infinite_reverse]"></div>
            <div className="absolute top-1/2 left-1/2 -translate-x-[40%] -translate-y-[60%] w-[500px] h-[500px] border-[1px] border-[#8a5f3b]/30 rounded-full pointer-events-none hidden md:block animate-[spin_60s_linear_infinite]"></div>
            
            {/* Elegant vertical & horizontal axis lines */}
            <div className="absolute top-0 bottom-0 left-1/2 w-[1px] bg-gradient-to-b from-transparent via-[#b29572]/30 to-transparent pointer-events-none"></div>
            <div className="absolute top-1/2 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-[#5d4631]/30 to-transparent pointer-events-none"></div>

            {/* Subtle floating minimal shapes */}
            <div className="absolute top-[25%] right-[25%] text-[#8a5f3b]/50 text-4xl rotate-45 pointer-events-none animate-pulse">✦</div>
            <div className="absolute bottom-[35%] left-[20%] text-[#b29572]/50 text-3xl pointer-events-none animate-bounce">✦</div>
            <div className="absolute top-[60%] right-[15%] text-[#e5dfd3]/20 text-2xl pointer-events-none animate-pulse">✦</div>

            {/* Subtle top border line element */}
            <div className="absolute top-0 inset-x-0 h-[2px] bg-gradient-to-r from-transparent via-[#b29572]/60 to-transparent w-full"></div>

            {/* Content Content Container */}
            <h1 className="serif text-4xl md:text-[4rem] leading-[1.05] font-light tracking-tight text-[#fffcf8] mb-8 max-w-6xl relative z-10 drop-shadow-xl hover:scale-105 transition-transform duration-1000 cursor-default">
              The Future Of <br /> <span className="italic text-[#f4eadc]">Personal Style.</span>
            </h1>
            <p className="text-xl md:text-2xl text-[#d4c3b3] mb-16 max-w-3xl font-light tracking-wide relative z-10 drop-shadow-md">
              Experience high-precision AI try-ons. See how premium collections fit your body instantly, without stepping into a fitting room.
            </p>
            <div className="relative z-10 backdrop-blur-sm rounded-full group">
              <button 
                onClick={() => {
                  window.scrollTo({ top: window.innerHeight, behavior: 'smooth' });
                }}
                className="bg-transparent border border-[#b29572] text-[#fffaf2] px-16 py-6 rounded-full text-[13px] font-bold uppercase tracking-[0.3em] group-hover:bg-[#b29572] group-hover:text-[#2a2018] group-hover:scale-105 transition-all duration-500 shadow-[0_0_40px_-10px_rgba(178,149,114,0.3)] group-hover:shadow-[0_0_60px_-10px_rgba(178,149,114,0.6)]"
              >
                Explore Collections
              </button>
            </div>

            {/* Bouncing scroll indicator */}
            <div className="absolute bottom-10 w-full flex justify-center animate-bounce text-[#b29572]/70 cursor-pointer hover:text-[#fffaf2] transition-colors"
                 onClick={() => window.scrollTo({ top: window.innerHeight, behavior: 'smooth' })}>
              <ChevronDown size={36} strokeWidth={1} />
            </div>
          </div>

          <div className="max-w-[1900px] w-full mx-auto px-6 md:px-10 xl:px-12 pt-10 pb-20">
            <div className="w-full max-w-[1850px] mx-auto space-y-12">

              {/* Horizontal Recommendation Bar - Sleek Inline Design */}
              {isLoggedinUser && hasPurchaseHistory && recommendedProducts.length > 0 && (
                <div 
                  ref={recRef} 
                  className={`w-full transition-all duration-[1200ms] ease-out transform ${
                    isRecVisible ? 'opacity-100 translate-x-0' : 'opacity-0 -translate-x-32'
                  }`}
                >
                  <section className="w-full bg-[#f4eadc]/80 backdrop-blur-xl border border-[#d4c3b3]/50 rounded-full px-5 md:px-8 py-2.5 shadow-[0_10px_40px_-20px_rgba(93,70,49,0.4)] transition-all duration-700 hover:shadow-[0_15px_50px_-20px_rgba(93,70,49,0.5)] hover:border-[#b29572]/40 hover:bg-[#fffcf8]/90 flex flex-col md:flex-row items-center gap-4 md:gap-8">
                    
                    <div className="flex items-center shrink-0 md:border-r border-[#d4c3b3]/40 pb-2 md:pb-0 md:pr-6 w-full md:w-auto justify-between md:justify-start">
                      <div className="flex items-center gap-3">
                        <span className="w-2 h-2 rounded-full bg-[#8a5f3b] animate-pulse"></span>
                        <h3 className="text-[13px] md:text-[15px] font-bold text-[#5d4631]">
                          Recommended For You
                        </h3>
                      </div>
                      {recommendationError && (
                        <p className="text-[10px] text-[#8b2f24] font-bold ml-4">{recommendationError}</p>
                      )}
                    </div>

                    <div className="flex-1 flex items-center gap-4 overflow-x-auto w-full no-scrollbar pb-1 md:pb-0 relative [mask-image:linear-gradient(to_right,transparent,black_1%,black_99%,transparent)] pt-1">
                      {recommendedProducts.map((item) => (
                        <button
                          key={`rec-item-${item.id}`}
                          type="button"
                          onClick={() => handleBuyNow(item)}
                          className="relative w-14 h-14 md:w-[4.25rem] md:h-[4.25rem] rounded-full overflow-hidden border-[2px] border-[#8a5f3b] bg-[#fffcf8] shrink-0 transition-all duration-500 hover:-translate-y-1 hover:border-[#5d4631] hover:shadow-[0_8px_20px_-8px_rgba(93,70,49,0.5)] cursor-pointer group flex items-center justify-center p-0.5"
                          aria-label={`Open ${item.name}`}
                          title={item.name}
                        >
                          <div className="w-full h-full bg-[#e5dfd3] rounded-full overflow-hidden relative">
                            <img
                              src={item.image}
                              alt={item.name}
                              className="absolute top-0 left-0 w-full h-full object-cover mix-blend-multiply scale-[1.3] translate-y-1.5 transition-transform duration-700 group-hover:scale-[1.6]"
                            />
                          </div>
                        </button>
                      ))}
                    </div>
                  </section>
                </div>
              )}

              <div className="space-y-32 w-full">
                {/* Sectioned products: men uppers, female uppers, men bottoms, female bottoms */}
                {[
                  { title: "Men's Tops", items: sectionedProducts.menUppers },
                  { title: "Women's Tops", items: sectionedProducts.womenUppers },
                  { title: "Men's Bottoms", items: sectionedProducts.menBottoms },
                  { title: "Women's Bottoms", items: sectionedProducts.womenBottoms }
                ].map((section) => (
                  <section id={section.title.replace(/ /g, '-')} key={section.title} className="flex flex-col items-center w-full scroll-mt-32">
                    <h3 className="serif text-5xl font-light tracking-tight text-[#5d4631] mb-12 text-center relative group inline-block cursor-default">
                      {section.title}
                      <span className="absolute -bottom-4 left-1/2 -translate-x-1/2 w-12 h-0.5 bg-[#b29572] transition-all duration-500 group-hover:w-full"></span>
                    </h3>
                    {section.items.length > 0 ? (
                      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-14 pb-6 px-2 md:px-4 w-full place-items-center">
                        {section.items.map((p) => (
                          <ProductCard key={p.id} product={p} onBuyNow={handleBuyNow} />
                        ))}
                      </div>
                    ) : (
                      <p className="text-base font-bold text-[#b29572] uppercase tracking-[0.15em]">No items in this section</p>
                    )}
                  </section>
                ))}
              </div>
            </div>
          </div>
        </main>
      );
    }

    return (
      <div className="flex-1 flex flex-col items-center justify-center p-20 bg-[#f4eadc]">
        <div className="w-20 h-20 bg-[#fffaf2] rounded-[2rem] shadow-sm flex items-center justify-center mb-8 border border-[#ead8bf]">
          <Sparkles size={28} className="text-[#b29572]" />
        </div>
        <h2 className="serif text-3xl font-light text-[#5d4631] mb-2">Workspace Initializing</h2>
        <button 
          onClick={() => setActiveTab('collections')} 
          className="mt-10 bg-[#7d6244] text-white px-10 py-4.5 rounded-full text-[10px] font-bold uppercase tracking-[0.4em] hover:bg-[#684f35] transition-all active:scale-95"
        >
          Return to Collections
        </button>
      </div>
    );
  };

  const [isLoggedinUser, setIsLoggedInUser] = useState(false);
  const [loginUsername, setLoginUsername] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [signupUsername, setSignupUsername] = useState('');
  const [signupPassword, setSignupPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [signupError, setSignupError] = useState('');
  const [authLoading, setAuthLoading] = useState(false);
  const [backendErrorShownLogin, setBackendErrorShownLogin] = useState(false);
  const [backendErrorShownSignup, setBackendErrorShownSignup] = useState(false);

  useEffect(() => {
    const userId = currentUser?.user_id;

    if (!isLoggedinUser || !userId) {
      setRecommendedProducts([]);
      setRecommendationError('');
      setIsLoadingRecommendations(false);
      setHasPurchaseHistory(false);
      return;
    }

    let cancelled = false;

    const loadRecommendations = async () => {
      setIsLoadingRecommendations(true);
      setRecommendationError('');

      try {
        const result = await fetchDashboard(userId);
        if (cancelled) return;

        if (!result.success) {
          setRecommendedProducts([]);
          setHasPurchaseHistory(false);
          setRecommendationError(result.error || 'Could not load recommendations right now.');
          return;
        }

        setHasPurchaseHistory(result.has_purchase_history);
        const backendRecommendations = result.recommendations || [];
        const lastPurchaseRelevant =
          result.last_purchase_category && result.last_purchase_gender
            ? backendRecommendations.filter(
                (item) =>
                  item.category === result.last_purchase_category &&
                  item.gender === result.last_purchase_gender
              )
            : [];

        const prioritized =
          lastPurchaseRelevant.length > 0
            ? [
                ...lastPurchaseRelevant,
                ...backendRecommendations.filter(
                  (item) =>
                    !(item.category === result.last_purchase_category && item.gender === result.last_purchase_gender)
                ),
              ]
            : backendRecommendations;
        const mappedProducts = mapDashboardRecommendationsToProducts(prioritized);
        setRecommendedProducts(mappedProducts);
      } catch {
        if (!cancelled) {
          setRecommendedProducts([]);
          setRecommendationError('Could not load recommendations right now.');
        }
      } finally {
        if (!cancelled) {
          setIsLoadingRecommendations(false);
        }
      }
    };

    void loadRecommendations();

    return () => {
      cancelled = true;
    };
  }, [isLoggedinUser, currentUser?.user_id, recommendationRefreshKey]);

  const handleLoginSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (authLoading) return;

    const username = loginUsername.trim();
    const password = loginPassword.trim();

    if (!username || !password) {
      setLoginError('Please enter username and password.');
      return;
    }

    setLoginError('');
    setAuthLoading(true);

    try {
      const result = await login(username, password);
      setBackendErrorShownLogin(false);

      if (result.success) {
        setIsLoggedInUser(true);
        setCurrentUser(result.user || null);
        setLoginPassword('');
        setActiveTab('collections');
        return;
      }

      const serverError = result.error || result.message || 'Unable to sign in right now.';
      const normalizedError = serverError.toLowerCase();
      if (normalizedError.includes('database connection failed')) {
        setLoginError('Backend is running, but the database is offline. Start MySQL and try again.');
      } else if (normalizedError.includes('invalid username or password')) {
        setLoginError('Incorrect credentials. Please sign in with the correct account, or create one.');
      } else {
        setLoginError(serverError);
      }
    } catch {
      if (!backendErrorShownLogin) {
        setLoginError('Cannot reach the backend right now. Please make sure the server is running.');
        setBackendErrorShownLogin(true);
      }
    } finally {
      setAuthLoading(false);
    }
  };

  const handleSignupSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (authLoading) return;

    const username = signupUsername.trim();
    const password = signupPassword.trim();

    if (!username || !password) {
      setSignupError('Please enter username and password.');
      return;
    }

    setSignupError('');
    setAuthLoading(true);

    try {
      const result = await register(username, password);
      setBackendErrorShownSignup(false);

      if (result.success) {
        setIsLoggedInUser(true);
        setCurrentUser(result.user || null);
        setSignupPassword('');
        setActiveTab('collections');
        return;
      }

      const serverError = result.error || result.message || 'Unable to create account right now.';
      if (serverError.toLowerCase().includes('database connection failed')) {
        setSignupError('Backend is running, but the database is offline. Start MySQL and try again.');
      } else {
        setSignupError(serverError);
      }
    } catch {
      if (!backendErrorShownSignup) {
        setSignupError('Cannot reach the backend right now. Please make sure the server is running.');
        setBackendErrorShownSignup(true);
      }
    } finally {
      setAuthLoading(false);
    }
  };

  if (activeTab === 'login') {
    return (
      <div className="min-h-screen bg-[#2a2018] flex flex-col items-center justify-center font-sans selection:bg-[#ead8bf] selection:text-[#5d4631] animate-in fade-in duration-700 relative overflow-hidden">
        
        {/* ARTISTIC BACKGROUND ELEMENTS FOR LOGIN */}
        {/* Aesthetic Fashion Background Image */}
        <div 
          className="absolute inset-0 opacity-[0.35] mix-blend-soft-light bg-cover bg-center bg-no-repeat pointer-events-none grayscale"
          style={{ backgroundImage: 'url("https://images.unsplash.com/photo-1490481651871-ab68de25d43d?q=80&w=2070&auto=format&fit=crop")' }}
        ></div>

        <div className="absolute inset-0 bg-[linear-gradient(to_right,#8a5f3b11_1px,transparent_1px),linear-gradient(to_bottom,#8a5f3b11_1px,transparent_1px)] bg-[size:4rem_4rem] mix-blend-screen pointer-events-none"></div>

        {/* Base soft glows */}
        <div className="absolute top-0 right-1/4 w-[900px] h-[900px] bg-[#8a5f3b] rounded-full blur-[180px] opacity-25 pointer-events-none translate-x-1/2 -translate-y-1/3 animate-[pulse_6s_ease-in-out_infinite]"></div>
        <div className="absolute bottom-0 left-1/4 w-[700px] h-[700px] bg-[#b29572] rounded-full blur-[160px] opacity-15 pointer-events-none -translate-x-1/2 translate-y-1/3 animate-[pulse_4s_cubic-bezier(0.4,0,0.6,1)_infinite]"></div>
        
        {/* Giant abstract geometric rings with spin animations */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[1600px] h-[1600px] border-[1px] border-[#b29572]/10 rounded-full pointer-events-none animate-[spin_180s_linear_infinite]"></div>
        <div className="absolute top-1/2 left-1/2 -translate-x-[40%] -translate-y-[60%] w-[800px] h-[800px] border-[1px] border-dashed border-[#8a5f3b]/15 rounded-full pointer-events-none hidden md:block animate-[spin_90s_linear_infinite_reverse]"></div>
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[1000px] h-[1000px] border-[1px] border-[#b29572]/15 rounded-full pointer-events-none animate-[spin_120s_linear_infinite]"></div>
        
        {/* Elegant vertical & horizontal axis lines */}
        <div className="absolute top-0 bottom-0 left-1/2 w-[1px] bg-gradient-to-b from-transparent via-[#b29572]/30 to-transparent pointer-events-none"></div>
        <div className="absolute left-0 right-0 top-1/2 h-[1px] bg-gradient-to-r from-transparent via-[#b29572]/15 to-transparent pointer-events-none"></div>

        {/* Minimalist floating elements */}
        <div className="absolute top-1/4 left-1/4 text-[#b29572]/40 text-2xl font-light pointer-events-none animate-pulse">+</div>
        <div className="absolute bottom-1/4 right-1/4 text-[#8a5f3b]/40 text-4xl font-light pointer-events-none animate-[pulse_3s_ease-in-out_infinite]">*</div>
        <div className="absolute top-1/3 right-1/3 w-3 h-3 border border-[#b29572]/40 rounded-full pointer-events-none animate-ping"></div>

        <div className="relative z-10 w-full max-w-[600px] min-h-[400px] flex flex-col justify-between px-16 py-12 bg-[#f4eadc]/95 backdrop-blur-xl rounded-[2.5rem] border border-[#d4c3b3] shadow-[0_0_80px_rgba(42,32,24,0.5)] text-center transition-all duration-700 hover:shadow-[0_0_100px_rgba(138,95,59,0.25)] hover:border-[#b29572]/40 group">
          <div className="absolute inset-4 border border-[#d4c3b3]/40 rounded-[2rem] pointer-events-none transition-all duration-500 group-hover:border-[#b29572]/30"></div>

          <div className="flex flex-col mt-2">
            <h1 className="serif text-5xl font-black tracking-tighter text-[#5d4631] mb-2 transform transition-transform duration-500 group-hover:scale-105">
              Virtual Fit <span className="text-[#a48867] inline-block transition-transform duration-500 group-hover:rotate-12">AI</span>
            </h1>
            <p className="text-[12px] font-bold uppercase tracking-[0.25em] text-[#b29572] mb-10">
              Sign in to your gallery
            </p>

            <form className="space-y-6 flex flex-col relative z-20" onSubmit={handleLoginSubmit}>
              <div className="flex flex-col text-left group/input mx-2">
                <label className="text-[11px] font-bold uppercase tracking-[0.25em] text-[#8a5f3b] mb-3 pl-4 transition-colors duration-300 group-hover/input:text-[#5d4631]">Name</label>
                <input 
                  type="text" 
                  required
                  placeholder="Enter your name" 
                  value={loginUsername}
                  onChange={(e) => {
                    setLoginUsername(e.target.value);
                    if (loginError) setLoginError('');
                  }}
                  disabled={authLoading}
                  className="w-full bg-[#fffcf8] border border-[#d4c3b3] py-4 px-8 rounded-full text-[14px] focus:outline-none focus:border-[#b29572] focus:ring-2 focus:ring-[#b29572]/20 transition-all duration-300 hover:border-[#b29572]/70 hover:shadow-md focus:scale-[1.02]"
                />
              </div>
              
              <div className="flex flex-col text-left group/input mx-2">
                <label className="text-[11px] font-bold uppercase tracking-[0.25em] text-[#8a5f3b] mb-3 pl-4 transition-colors duration-300 group-hover/input:text-[#5d4631]">Password</label>
                <input 
                  type="password" 
                  required
                  placeholder="Enter your password" 
                  value={loginPassword}
                  onChange={(e) => {
                    setLoginPassword(e.target.value);
                    if (loginError) setLoginError('');
                  }}
                  disabled={authLoading}
                  className="w-full bg-[#fffcf8] border border-[#d4c3b3] py-4 px-8 rounded-full text-[14px] focus:outline-none focus:border-[#b29572] focus:ring-2 focus:ring-[#b29572]/20 transition-all duration-300 hover:border-[#b29572]/70 hover:shadow-md focus:scale-[1.02]"
                />
              </div>

              {loginError && (
                <p className="mx-2 text-left text-[12px] font-bold text-[#8b2f24] bg-[#fbe8e3] border border-[#e8c0b8] rounded-2xl px-4 py-3">
                  {loginError}
                </p>
              )}

              <button 
                type="submit"
                disabled={authLoading}
                className="mt-6 mx-2 px-10 py-4.5 rounded-full text-[13px] font-black uppercase tracking-[0.3em] transition-all duration-500 shadow-[0_10px_30px_rgba(93,70,49,0.25)] bg-[#5d4631] text-[#fffaf2] hover:bg-[#3a2c20] hover:scale-[1.03] hover:shadow-[0_15px_40px_rgba(93,70,49,0.4)] active:scale-95"
              >
                {authLoading ? 'Signing In...' : 'Enter Studio'}
              </button>
            </form>
          </div>

          <div className="mt-8 pt-6 border-t border-[#d4c3b3]/50 flex flex-col gap-5 relative z-20">
            <button 
                onClick={() => {
                  setIsLoggedInUser(false);
                  setCurrentUser(null);
                  setLoginError('');
                  setSignupError('');
                  setActiveTab('collections');
                }}
                type="button"
                className="mx-2 px-10 py-5 rounded-full text-[12px] font-bold uppercase tracking-[0.25em] transition-all duration-300 bg-transparent border-2 border-[#5d4631] text-[#5d4631] hover:bg-[#5d4631] hover:text-[#fffaf2] hover:shadow-xl hover:-translate-y-1 active:scale-95"
              >
                Continue as Guest
            </button>
            <div className="text-[12px] text-[#8a5f3b]">
              New here? <span onClick={() => {
                setLoginError('');
                setSignupError('');
                setActiveTab('signup');
              }} className="font-bold cursor-pointer transition-colors hover:text-[#5d4631] relative inline-block after:content-[''] after:absolute after:bottom-0 after:left-0 after:w-full after:h-[1px] after:bg-[#5d4631] after:scale-x-0 hover:after:scale-x-100 after:transition-transform after:duration-300 after:origin-right hover:after:origin-left">Create an account</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (activeTab === 'signup') {
    return (
      <div className="min-h-screen bg-[#2a2018] flex flex-col items-center justify-center font-sans selection:bg-[#ead8bf] selection:text-[#5d4631] animate-in fade-in duration-700 relative overflow-hidden">
        
        {/* ARTISTIC BACKGROUND ELEMENTS FOR SIGNUP */}
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#8a5f3b11_1px,transparent_1px),linear-gradient(to_bottom,#8a5f3b11_1px,transparent_1px)] bg-[size:4rem_4rem] mix-blend-screen pointer-events-none"></div>

        {/* Base soft glows */}
        <div className="absolute top-0 right-1/4 w-[900px] h-[900px] bg-[#8a5f3b] rounded-full blur-[180px] opacity-25 pointer-events-none translate-x-1/2 -translate-y-1/3 animate-[pulse_6s_ease-in-out_infinite]"></div>
        <div className="absolute bottom-0 left-1/4 w-[700px] h-[700px] bg-[#b29572] rounded-full blur-[160px] opacity-15 pointer-events-none -translate-x-1/2 translate-y-1/3 animate-[pulse_4s_cubic-bezier(0.4,0,0.6,1)_infinite]"></div>
        
        {/* Giant abstract geometric rings with spin animations */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[1600px] h-[1600px] border-[1px] border-[#b29572]/10 rounded-full pointer-events-none animate-[spin_180s_linear_infinite]"></div>
        <div className="absolute top-1/2 left-1/2 -translate-x-[40%] -translate-y-[60%] w-[800px] h-[800px] border-[1px] border-dashed border-[#8a5f3b]/15 rounded-full pointer-events-none hidden md:block animate-[spin_90s_linear_infinite_reverse]"></div>
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[1000px] h-[1000px] border-[1px] border-[#b29572]/15 rounded-full pointer-events-none animate-[spin_120s_linear_infinite]"></div>
        
        {/* Elegant vertical & horizontal axis lines */}
        <div className="absolute top-0 bottom-0 left-1/2 w-[1px] bg-gradient-to-b from-transparent via-[#b29572]/30 to-transparent pointer-events-none"></div>
        <div className="absolute left-0 right-0 top-1/2 h-[1px] bg-gradient-to-r from-transparent via-[#b29572]/15 to-transparent pointer-events-none"></div>

        {/* Minimalist floating elements */}
        <div className="absolute top-1/4 left-1/4 text-[#b29572]/40 text-2xl font-light pointer-events-none animate-pulse">+</div>
        <div className="absolute bottom-1/4 right-1/4 text-[#8a5f3b]/40 text-4xl font-light pointer-events-none animate-[pulse_3s_ease-in-out_infinite]">*</div>
        <div className="absolute top-1/3 right-1/3 w-3 h-3 border border-[#b29572]/40 rounded-full pointer-events-none animate-ping"></div>


        <div className="relative z-10 w-full max-w-[1000px] min-h-[550px] flex flex-col justify-between px-28 py-16 bg-[#f4eadc]/95 backdrop-blur-xl rounded-[3rem] border border-[#d4c3b3] shadow-[0_0_80px_rgba(42,32,24,0.5)] text-center transition-all duration-700 hover:shadow-[0_0_100px_rgba(138,95,59,0.25)] hover:border-[#b29572]/40 group">
          <div className="absolute inset-4 border border-[#d4c3b3]/40 rounded-[2.2rem] pointer-events-none transition-all duration-500 group-hover:border-[#b29572]/30"></div>

          <div className="flex flex-col mt-2">
            <h1 className="serif text-5xl font-black tracking-tighter text-[#5d4631] mb-2 transform transition-transform duration-500 group-hover:scale-105">
              Virtual Fit <span className="text-[#a48867] inline-block transition-transform duration-500 group-hover:rotate-12">AI</span>
            </h1>
            <p className="text-[12px] font-bold uppercase tracking-[0.25em] text-[#b29572] mb-10">
              Create your account
            </p>

            <form className="space-y-6 flex flex-col relative z-20" onSubmit={handleSignupSubmit}>
              <div className="flex flex-col text-left group/input mx-2">
                <label className="text-[11px] font-bold uppercase tracking-[0.25em] text-[#8a5f3b] mb-3 pl-4 transition-colors duration-300 group-hover/input:text-[#5d4631]">Name</label>
                <input 
                  type="text" 
                  required
                  placeholder="Enter your name" 
                  value={signupUsername}
                  onChange={(e) => {
                    setSignupUsername(e.target.value);
                    if (signupError) setSignupError('');
                  }}
                  disabled={authLoading}
                  className="w-full bg-[#fffcf8] border border-[#d4c3b3] py-4 px-8 rounded-full text-[14px] focus:outline-none focus:border-[#b29572] focus:ring-2 focus:ring-[#b29572]/20 transition-all duration-300 hover:border-[#b29572]/70 hover:shadow-md focus:scale-[1.02]"
                />
              </div>

              <div className="flex flex-col text-left group/input mx-2">
                <label className="text-[11px] font-bold uppercase tracking-[0.25em] text-[#8a5f3b] mb-3 pl-4 transition-colors duration-300 group-hover/input:text-[#5d4631]">Password</label>
                <input 
                  type="password" 
                  required
                  placeholder="Choose a password" 
                  value={signupPassword}
                  onChange={(e) => {
                    setSignupPassword(e.target.value);
                    if (signupError) setSignupError('');
                  }}
                  disabled={authLoading}
                  className="w-full bg-[#fffcf8] border border-[#d4c3b3] py-4 px-8 rounded-full text-[14px] focus:outline-none focus:border-[#b29572] focus:ring-2 focus:ring-[#b29572]/20 transition-all duration-300 hover:border-[#b29572]/70 hover:shadow-md focus:scale-[1.02]"
                />
              </div>

              {signupError && (
                <p className="mx-2 text-left text-[12px] font-bold text-[#8b2f24] bg-[#fbe8e3] border border-[#e8c0b8] rounded-2xl px-4 py-3">
                  {signupError}
                </p>
              )}

              <button 
                type="submit"
                disabled={authLoading}
                className="mt-6 mx-2 px-10 py-4.5 rounded-full text-[13px] font-black uppercase tracking-[0.3em] transition-all duration-500 shadow-[0_10px_30px_rgba(93,70,49,0.25)] bg-[#5d4631] text-[#fffaf2] hover:bg-[#3a2c20] hover:scale-[1.03] hover:shadow-[0_15px_40px_rgba(93,70,49,0.4)] active:scale-95"
              >
                {authLoading ? 'Creating Account...' : 'Sign Up'}
              </button>
            </form>
          </div>

          <div className="mt-8 pt-6 border-t border-[#d4c3b3]/50 flex flex-col gap-5 relative z-20">
               <button 
                onClick={() => {
                  setIsLoggedInUser(false);
                  setCurrentUser(null);
                  setLoginError('');
                  setSignupError('');
                  setActiveTab('collections');
                }}
                type="button"
                className="mx-2 px-10 py-5 rounded-full text-[12px] font-bold uppercase tracking-[0.25em] transition-all duration-300 bg-transparent border-2 border-[#5d4631] text-[#5d4631] hover:bg-[#5d4631] hover:text-[#fffaf2] hover:shadow-xl hover:-translate-y-1 active:scale-95"
              >
                Continue as Guest
            </button>
            <div className="text-[12px] text-[#8a5f3b]">
              Already have an account? <span onClick={() => {
                setLoginError('');
                setSignupError('');
                setActiveTab('login');
              }} className="font-bold cursor-pointer transition-colors hover:text-[#5d4631] relative inline-block after:content-[''] after:absolute after:bottom-0 after:left-0 after:w-full after:h-[1px] after:bg-[#5d4631] after:scale-x-0 hover:after:scale-x-100 after:transition-transform after:duration-300 after:origin-right hover:after:origin-left">Sign in</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-[#f4eadc] text-[#5d4631] selection:bg-[#ead8bf] selection:text-[#5d4631]">
      {/* Dynamic Header / Navbar overlaying everything */}
      <nav className="fixed w-full px-8 py-6 flex justify-between items-center z-50 transition-colors duration-500 border-b bg-[#f4eadc]/95 backdrop-blur-md border-[#e5dfd3]">
        <div className="serif text-2xl font-black tracking-tighter text-[#5d4631]">
          Virtual Fit <span className="text-[#a48867]">AI</span>
        </div>
        <div className="hidden md:flex gap-10 text-[11px] font-bold uppercase tracking-[0.2em] text-[#8a5f3b]">
          <button onClick={() => { setActiveTab('collections'); }} className="hover:text-[#5d4631] transition text-[#5d4631]">Collections</button>
          <button onClick={() => { setSelectedProduct(null); setActiveTab('studio'); }} className="hover:text-[#5d4631] transition">Studio</button>
        </div>
        <button 
          className="px-8 py-3 rounded-full text-[10px] font-bold uppercase tracking-widest transition shadow-md bg-[#5d4631] text-[#fffaf2] hover:bg-[#4a3726]"
          onClick={() => {
            const firstItem = displayProducts[0];
            if(firstItem) handleBuyNow(firstItem);
          }}
        >
          Try It On
        </button>
      </nav>

      <div className="flex-1 flex flex-col min-h-screen overflow-y-auto">
        {renderContent()}
      </div>
    </div>
  );
};

export default App;
