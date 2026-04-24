import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Camera, ChevronLeft, Loader2, Send, Sparkles, User, Sun, Shirt, Wand2, Layers, Smartphone } from 'lucide-react';
import { Product } from '../types';
import { FRONTEND_TO_BACKEND_PRODUCT_ID, MOCK_PRODUCTS } from '../constants';
import { explainSize, chat, detectSkinTone, generateVTON, type SizeResult } from '../services/backendService';

type CoachMessage = {
  role: 'user' | 'assistant';
  content: string;
  pairedProducts?: Product[];
};

type UploadSourceDimensions = {
  width: number;
  height: number;
};

interface StudioViewProps {
  product?: Product | null;
  onBack: () => void;
  onPurchase?: (product: Product) => Promise<void>;
  onSelectProduct?: (product: Product) => void;
  previousProduct?: Product;
  onGoToPrevious?: () => void;
}

const toStudioGender = (productGender?: Product['gender']): 'womens' | 'mens' => {
  return productGender === 'Women' ? 'womens' : 'mens';
};

const StudioView: React.FC<StudioViewProps> = ({ product, onBack, onPurchase, onSelectProduct, previousProduct, onGoToPrevious }) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [uploadedImage, setUploadedImage] = useState<string | null>(null);
  const [tryOnImage, setTryOnImage] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [detectedTone, setDetectedTone] = useState<string | null>(null);
  const [detectedColors, setDetectedColors] = useState<string[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [isCoachLoading, setIsCoachLoading] = useState(false);
  const [selectedFit, setSelectedFit] = useState<'Slim Fit' | 'Regular Fit' | 'Relaxed Fit' | null>(null);
  const [coachMessages, setCoachMessages] = useState<CoachMessage[]>(() => {
    return [
      {
        role: 'assistant',
        content: `Hi Guest! I'm your AI Size Coach. How would you like the ${product?.name || 'clothing'} to fit?`
      }
    ];
  });
  const [isCalculatingSize, setIsCalculatingSize] = useState(false);
  const [sizeError, setSizeError] = useState('');
  const [sizeResult, setSizeResult] = useState<SizeResult | null>(null);
  const [isSavingPurchase, setIsSavingPurchase] = useState(false);
  const [purchaseFeedback, setPurchaseFeedback] = useState('');
  const [purchaseError, setPurchaseError] = useState('');
  const [hasShownPairingRec, setHasShownPairingRec] = useState(false);
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const pairingMsgRef = useRef<HTMLDivElement | null>(null);
  const [pairedProduct, setPairedProduct] = useState<Product | null>(null);
  const [outfitStep, setOutfitStep] = useState<'idle' | 'step1' | 'step2'>('idle');
  const [vtonPrompt, setVtonPrompt] = useState('');
  const [uploadElapsedSec, setUploadElapsedSec] = useState(0);
  const [uploadProgressPct, setUploadProgressPct] = useState(0);
  const [uploadSourceDimensions, setUploadSourceDimensions] = useState<UploadSourceDimensions | null>(null);

  const [gender, setGender] = useState<'womens' | 'mens'>(() => toStudioGender(product?.gender));
  const [weight, setWeight] = useState('');
  const [heightFeet, setHeightFeet] = useState('');
  const [heightInches, setHeightInches] = useState('');
  const [skinTone, setSkinTone] = useState<string>('Fair');

  const quickReplies: Array<'Slim Fit' | 'Regular Fit' | 'Relaxed Fit'> = ['Slim Fit', 'Regular Fit', 'Relaxed Fit'];

  useEffect(() => {
    setGender(toStudioGender(product?.gender));
    setPurchaseFeedback('');
    setPurchaseError('');
    setHasShownPairingRec(false);
    setSizeResult(null);
    setSizeError('');
    setUploadedImage(null);
    setTryOnImage(null);
    setUploadError('');
    setDetectedTone(null);
    setDetectedColors([]);
    setSelectedFit(null);
    setPairedProduct(null);
    setOutfitStep('idle');
    setVtonPrompt('');
    setUploadElapsedSec(0);
    setUploadProgressPct(0);
    setUploadSourceDimensions(null);
    setCoachMessages([
      {
        role: 'assistant',
        content: `Hi! I'm your AI Size Coach. How would you like the ${product?.name || 'clothing'} to fit?`
      }
    ]);
  }, [product?.id]);

  useEffect(() => {
    if (!isUploading) {
      setUploadElapsedSec(0);
      setUploadProgressPct(0);
      return;
    }

    const startedAt = Date.now();
    setUploadElapsedSec(0);
    setUploadProgressPct(2);

    const timerId = window.setInterval(() => {
      const elapsed = Math.floor((Date.now() - startedAt) / 1000);
      setUploadElapsedSec(elapsed);
      setUploadProgressPct(Math.min(95, Math.max(2, Math.round((elapsed / 90) * 95))));
    }, 1000);

    return () => window.clearInterval(timerId);
  }, [isUploading]);

  // Auto-scroll: show top of pairing message so text is visible, else scroll to bottom
  useEffect(() => {
    const lastMsg = coachMessages[coachMessages.length - 1];
    if (lastMsg?.pairedProducts) {
      pairingMsgRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else {
      chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [coachMessages]);

  // Trigger outfit pairing recommendation after size is calculated
  useEffect(() => {
    if (!sizeResult?.success || hasShownPairingRec) return;

    setHasShownPairingRec(true);

    // Use product ID to reliably detect upper vs bottom:
    // m1,m2,m3 = men's uppers | m4,m5,m6 = men's bottoms
    // w1,w2,w3 = women's uppers | w4,w5,w6 = women's bottoms
    const upperIds = new Set(['m1', 'm2', 'm3', 'w1', 'w2', 'w3']);
    const bottomIds = new Set(['m4', 'm5', 'm6', 'w4', 'w5', 'w6']);
    const isUpper = product ? upperIds.has(product.id) : false;
    const isBottom = product ? bottomIds.has(product.id) : false;

    // Suggest the opposite type, same gender
    const complementaryProducts = MOCK_PRODUCTS.filter((p) => {
      if (product && p.id === product.id) return false;
      if (product && p.gender !== product.gender) return false;
      if (isUpper) return bottomIds.has(p.id);   // top selected → recommend bottoms
      if (isBottom) return upperIds.has(p.id);   // bottom selected → recommend tops
      return false;
    }).slice(0, 3);

    const category = isUpper ? 'bottoms' : isBottom ? 'tops' : 'pieces';
    const msg = complementaryProducts.length > 0
      ? `Great look! Here are some ${category} that would pair perfectly with your ${product?.name || 'clothing'}:`
      : `You're rocking the ${product?.name || 'garment'}! Feel free to ask me for pairing suggestions.`;

    setCoachMessages((prev) => [
      ...prev,
      {
        role: 'assistant',
        content: msg,
        pairedProducts: complementaryProducts.length > 0 ? complementaryProducts : undefined,
      },
    ]);
  }, [sizeResult, hasShownPairingRec, product]);

  const sizeOrder: Array<'S' | 'M' | 'L' | 'XL'> = ['S', 'M', 'L', 'XL'];

  const COLOR_HEX_MAP: Record<string, string> = {
    Pastels: '#f3e8ff',
    'Light Blue': '#add8e6',
    'Soft Pink': '#f8c8dc',
    Lavender: '#b57edc',
    'Mint Green': '#98ff98',
    Coral: '#ff7f50',
    Peach: '#ffdab9',
    'Light Gray': '#d3d3d3',
    'Sky Blue': '#87ceeb',
    Cream: '#fffdd0',
    Navy: '#1f3b70',
    'Olive Green': '#708238',
    Burgundy: '#800020',
    Teal: '#008080',
    Mustard: '#d4a017',
    'Earth Tones': '#8b6f47',
    'Warm Browns': '#8b5a2b',
    Orange: '#ff8c00',
    Gold: '#d4af37',
    'Forest Green': '#228b22',
    'Bright Colors': '#ff4d6d',
    'Cobalt Blue': '#0047ab',
    Emerald: '#50c878',
    'Hot Pink': '#ff69b4',
    White: '#ffffff',
    'Bright White': '#ffffff',
    'Electric Blue': '#7df9ff',
    Fuchsia: '#ff00ff',
    Yellow: '#ffd300',
    'Ruby Red': '#9b111e',
    Sapphire: '#0f52ba',
    Black: '#111111',
    Gray: '#808080',
    'Denim Blue': '#1560bd'
  };

  const normalizeDetectedTone = (tone: string): string => {
    const key = tone.trim().toLowerCase();
    if (key === 'fair') return 'Fair';
    if (key === 'light') return 'Light';
    if (key === 'medium') return 'Medium';
    if (key === 'olive') return 'Olive';
    if (key === 'tan') return 'Tan';
    if (key === 'dark') return 'Dark';
    if (key === 'deep') return 'Deep';
    return 'Medium';
  };

  const colorToHex = (colorName: string): string => {
    return COLOR_HEX_MAP[colorName] || '#d4c3b3';
  };

  const sanitizeCoachText = (text: string): string => {
    return text
      .replace(/!\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/\[(.*?)\]\((.*?)\)/g, '$1')
      .replace(/\*\*/g, '')
      .replace(/\*/g, '')
      .replace(/\b\d+\.\s*/g, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
  };

  const toConciseCoachText = (rawText: string): string => {
    const cleaned = sanitizeCoachText(rawText);
    const sentences = cleaned.split(/(?<=[.!?])\s+/).filter(Boolean);
    const concise = sentences.slice(0, 2).join(' ').trim();
    const maxLen = 220;

    if (concise.length <= maxLen) {
      return concise;
    }

    return `${concise.slice(0, maxLen).trim()}...`;
  };

  const toShortSentence = (rawText: string): string => {
    const cleaned = sanitizeCoachText(rawText);
    const firstSentence = cleaned.split(/(?<=[.!?])\s+/).filter(Boolean)[0] || cleaned;
    const maxLen = 140;
    if (firstSentence.length <= maxLen) {
      return firstSentence;
    }
    return `${firstSentence.slice(0, maxLen).trim()}...`;
  };

  const isGenderMismatchUploadError = (message: string): boolean => {
    const normalized = message.toLowerCase();
    return normalized.includes("women's section") || normalized.includes("men's section");
  };

  const appendCoachAssistantMessage = (content: string) => {
    setCoachMessages((prev) => {
      const last = prev[prev.length - 1];
      if (last?.role === 'assistant' && last.content === content) {
        return prev;
      }
      return [...prev, { role: 'assistant', content }];
    });
  };

  const getAdjustedSizeByFit = (baseSize: 'S' | 'M' | 'L' | 'XL', fit: 'Slim Fit' | 'Regular Fit' | 'Relaxed Fit') => {
    const baseIndex = sizeOrder.indexOf(baseSize);
    if (baseIndex < 0) return baseSize;

    if (fit === 'Relaxed Fit') {
      return sizeOrder[Math.min(baseIndex + 1, sizeOrder.length - 1)];
    }
    if (fit === 'Slim Fit') {
      return sizeOrder[Math.max(baseIndex - 1, 0)];
    }
    return baseSize;
  };

  const buildFitGuidance = (fit: 'Slim Fit' | 'Regular Fit' | 'Relaxed Fit', baseSize: 'S' | 'M' | 'L' | 'XL') => {
    const adjustedSize = getAdjustedSizeByFit(baseSize, fit);

    if (fit === 'Regular Fit') {
      return `Your recommended size is ${baseSize}. ${baseSize} is perfect for a regular fit.`;
    }

    if (fit === 'Relaxed Fit') {
      if (adjustedSize === baseSize) {
        return `Your recommended size is ${baseSize}. For a relaxed fit, stay at ${baseSize} (already the loosest practical option).`;
      }
      return `Your recommended size is ${baseSize}. For a relaxed fit, you can go for ${adjustedSize}.`;
    }

    if (adjustedSize === baseSize) {
      return `Your recommended size is ${baseSize}. For a slim fit, stay at ${baseSize} (already the smallest practical option).`;
    }
    return `Your recommended size is ${baseSize}. For a slim fit, you can go for ${adjustedSize}.`;
  };

  const getLiveBaseSize = async (): Promise<'S' | 'M' | 'L' | 'XL' | null> => {
    if (sizeResult?.success && sizeResult.calculated_size) {
      return sizeResult.calculated_size;
    }

    const weightValue = parseFloat(weight);
    const feetValue = parseFloat(heightFeet || '0');
    const inchesValue = parseFloat(heightInches || '0');
    const totalHeightFeet = feetValue + (inchesValue / 12);

    if (Number.isNaN(weightValue) || weightValue <= 0) {
      setSizeError('Enter a valid weight in KG to get fit-based size guidance.');
      return null;
    }

    if (!Number.isFinite(totalHeightFeet) || totalHeightFeet <= 0) {
      setSizeError('Enter a valid height (feet/inches) to get fit-based size guidance.');
      return null;
    }

    try {
      const result = await explainSize(weightValue, totalHeightFeet, skinTone);
      if (!result.success) {
        setSizeError(result.error || 'Could not calculate size.');
        return null;
      }
      setSizeResult(result);
      setSizeError('');
      return result.calculated_size;
    } catch {
      setSizeError('Backend not reachable. Make sure Flask API is running on port 5000.');
      return null;
    }
  };

  const sendCoachMessage = async (overrideMessage?: string, fitIntent?: 'Slim Fit' | 'Regular Fit' | 'Relaxed Fit') => {
    const currentSectionGender: 'Men' | 'Women' = gender === 'womens' ? 'Women' : 'Men';
    const messageToSend = (overrideMessage ?? chatInput).trim();

    if (!messageToSend || isCoachLoading) {
      return;
    }

    const historyForApi = coachMessages.map((msg) => ({ role: msg.role, content: msg.content }));
    const userMessage: CoachMessage = { role: 'user', content: messageToSend };
    const hasFitIntent = Boolean(fitIntent);
    let fitGuidance = '';

    if (fitIntent) {
      const baseSize = await getLiveBaseSize();
      if (!baseSize) {
        setCoachMessages((prev) => [
          ...prev,
          userMessage,
          { role: 'assistant', content: 'Please add valid measurements first so I can adjust your size for this fit.' }
        ]);
        return;
      }
      fitGuidance = buildFitGuidance(fitIntent, baseSize);
    }

    const aiPrompt = hasFitIntent
      ? `User selected ${fitIntent}. Based on what I'm viewing, explicitly suggest exactly ONE complementary item from the catalog that pairs well with it (e.g., recommend matching bottoms if viewing a top) from the ${currentSectionGender} section. Return a natural, short sentence. No markdown.`
      : messageToSend;

    setCoachMessages((prev) => [...prev, userMessage]);
    setChatInput('');
    setIsCoachLoading(true);

    try {
      const backendProductId = FRONTEND_TO_BACKEND_PRODUCT_ID[product.id] || product.id;
      const response = await chat(undefined, backendProductId, aiPrompt, historyForApi, currentSectionGender);

      if (response.success && response.response) {
        const aiText = hasFitIntent ? toShortSentence(response.response as string) : toConciseCoachText(response.response as string);
        const finalText = hasFitIntent && fitGuidance ? `${fitGuidance} ${aiText}`.trim() : aiText;
        appendCoachAssistantMessage(finalText);
      } else {
        setCoachMessages((prev) => [
          ...prev,
          {
            role: 'assistant',
            content: response.error || 'I could not respond right now. Please try again in a moment.'
          }
        ]);
      }
    } catch {
      setCoachMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: 'AI coach is offline right now. Ensure backend is running and try again.'
        }
      ]);
    } finally {
      setIsCoachLoading(false);
    }
  };

  const handleRecommendSize = async () => {
    setSizeError('');

    const weightValue = parseFloat(weight);
    const feetValue = parseFloat(heightFeet || '0');
    const inchesValue = parseFloat(heightInches || '0');
    const totalHeightFeet = feetValue + (inchesValue / 12);

    if (Number.isNaN(weightValue) || weightValue <= 0) {
      setSizeError('Enter a valid weight in KG.');
      return;
    }

    if (!Number.isFinite(totalHeightFeet) || totalHeightFeet <= 0) {
      setSizeError('Enter a valid height (feet/inches).');
      return;
    }

    try {
      setIsCalculatingSize(true);
      const result = await explainSize(weightValue, totalHeightFeet, skinTone);

      if (!result.success) {
        setSizeResult(null);
        setSizeError(result.error || 'Could not calculate size. Try again.');
        return;
      }

      setSizeResult(result);
    } catch (error) {
      setSizeResult(null);
      setSizeError('Backend not reachable. Make sure Flask API is running on port 5000.');
    } finally {
      setIsCalculatingSize(false);
    }
  };

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const isValidationBlockingUploadError = (message: string): boolean => {
    const normalized = message.toLowerCase();
    return (
      normalized.includes("women's section") ||
      normalized.includes("men's section") ||
      normalized.includes('clear human photo') ||
      normalized.includes('adult photo only') ||
      normalized.includes('could not validate this photo')
    );
  };

  const applySkinToneResult = (result: Awaited<ReturnType<typeof detectSkinTone>> | null) => {
    if (!result?.success) return;
    const tone = result.detected_skin_tone;
    const recommended = result.color_recommendations?.recommended_colors || [];
    const normalizedTone = normalizeDetectedTone(tone);
    setDetectedTone(tone);
    setDetectedColors(recommended);
    setSkinTone(normalizedTone);
    appendCoachAssistantMessage(`Detected skin tone: ${normalizedTone}.`);
  };

  const buildVtonPrompt = (garmentLabel: string) => {
    const manualPrompt = vtonPrompt.trim();
    if (manualPrompt) {
      return manualPrompt;
    }

    return `Virtual try-on edit for ${garmentLabel}. Keep identity, face, body shape, pose, and background unchanged. Preserve realistic lighting and cloth texture.`;
  };

  const normalizeUploadForVton = (file: File): Promise<{ dataUrl: string; width: number; height: number }> => {
    return new Promise((resolve, reject) => {
      const objectUrl = URL.createObjectURL(file);
      const img = new Image();

      img.onload = () => {
        try {
          const width = img.naturalWidth || img.width;
          const height = img.naturalHeight || img.height;

          if (width <= 0 || height <= 0) {
            reject(new Error('Could not read this image. Please try another file.'));
            return;
          }

          if (width >= height) {
            reject(new Error('Please upload a vertical (portrait) full-body photo for best results.'));
            return;
          }

          const maxLongSide = 1536;
          const scale = Math.min(1, maxLongSide / Math.max(width, height));
          const outWidth = Math.max(1, Math.round(width * scale));
          const outHeight = Math.max(1, Math.round(height * scale));

          const canvas = document.createElement('canvas');
          canvas.width = outWidth;
          canvas.height = outHeight;

          const ctx = canvas.getContext('2d');
          if (!ctx) {
            reject(new Error('Could not process this image. Please try another file.'));
            return;
          }

          ctx.drawImage(img, 0, 0, outWidth, outHeight);
          const dataUrl = canvas.toDataURL('image/jpeg', 0.92);

          resolve({ dataUrl, width: outWidth, height: outHeight });
        } finally {
          URL.revokeObjectURL(objectUrl);
        }
      };

      img.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        reject(new Error('Could not read this image. Please try another file.'));
      };

      img.src = objectUrl;
    });
  };

  const processUploadedImage = async (imageDataUrl: string, sourceDims?: UploadSourceDimensions | null) => {
    setIsUploading(true);
    setUploadError('');
    setOutfitStep('idle');
    setDetectedTone(null);
    setDetectedColors([]);
    setCoachMessages((prev) => prev.filter((msg) => !(msg.role === 'assistant' && msg.content.startsWith('Detected skin tone:'))));

    const backendProductId = FRONTEND_TO_BACKEND_PRODUCT_ID[product.id];
    if (!backendProductId) {
      setIsUploading(false);
      setUploadError('This selected item is not mapped for virtual try-on yet.');
      return;
    }
    const expectedSectionGender: 'Men' | 'Women' = gender === 'womens' ? 'Women' : 'Men';
    const sourceWidth = sourceDims?.width || uploadSourceDimensions?.width;
    const sourceHeight = sourceDims?.height || uploadSourceDimensions?.height;
    const pendingSkinTone = detectSkinTone(imageDataUrl)
      .catch(() => null);

    try {
      // ── OUTFIT MODE: sequential VTON (top then bottom) for stable single-person output ──
      if (pairedProduct) {
        const pairedBackendId = FRONTEND_TO_BACKEND_PRODUCT_ID[pairedProduct.id];
        if (!pairedBackendId) {
          setUploadError('The paired item is not mapped for virtual try-on.');
          setIsUploading(false);
          return;
        }

        // Always send top first then bottom for a more stable outfit render.
        const topBackendId    = isCurrentProductUpper ? backendProductId : pairedBackendId;
        const bottomBackendId = isCurrentProductUpper ? pairedBackendId  : backendProductId;
        const topName = isCurrentProductUpper ? product.name : pairedProduct.name;
        const bottomName = isCurrentProductUpper ? pairedProduct.name : product.name;
        const outfitLabel = `${topName} and ${bottomName}`;

        // Pass 1: apply top garment.
        setOutfitStep('step1');
        const step1 = await generateVTON(
          imageDataUrl,
          topBackendId,
          undefined,
          expectedSectionGender,
          undefined,
          buildVtonPrompt(topName),
          topName,
          sourceWidth,
          sourceHeight,
        );

        if (!(step1.success && step1.generated_image)) {
          setOutfitStep('idle');
          setTryOnImage(null);
          const message = step1.error || 'Outfit try-on failed while applying the top. Please try again.';
          setUploadError(message);
          if (!isValidationBlockingUploadError(message)) {
            applySkinToneResult(await pendingSkinTone);
          }
          return;
        }

        // Pass 2: apply bottom garment on top-pass result.
        setOutfitStep('step2');
        const step2 = await generateVTON(
          step1.generated_image,
          bottomBackendId,
          undefined,
          expectedSectionGender,
          undefined,
          buildVtonPrompt(outfitLabel),
          bottomName,
          sourceWidth,
          sourceHeight,
        );

        setOutfitStep('idle');

        if (step2.success && step2.generated_image) {
          setUploadProgressPct(100);
          setTryOnImage(step2.generated_image);
          setUploadError('');
          applySkinToneResult(await pendingSkinTone);
          setCoachMessages((prev) => [
            ...prev,
            { role: 'assistant', content: `Full outfit look ready! You\'re wearing the ${topName} with the ${bottomName}.` }
          ]);
        } else {
          // Keep pass-1 result as graceful fallback when pass-2 fails.
          setTryOnImage(step1.generated_image);
          const message = step2.error || 'Bottom application failed, but top look is ready. Try again to complete full outfit.';
          setUploadError(message);
          if (!isValidationBlockingUploadError(message)) {
            applySkinToneResult(await pendingSkinTone);
          }
        }
        return;
      }

      // ── SINGLE PRODUCT VTON ───────────────────────────────────────────────
      const garmentLabel = product.name;
      const singlePrompt = buildVtonPrompt(garmentLabel);
      const result = await generateVTON(
        imageDataUrl,
        backendProductId,
        undefined,
        expectedSectionGender,
        undefined,
        singlePrompt,
        garmentLabel,
        sourceWidth,
        sourceHeight,
      );
      if (result.success && result.generated_image) {
        setUploadProgressPct(100);
        setTryOnImage(result.generated_image);
        setUploadError('');
        applySkinToneResult(await pendingSkinTone);
        return;
      }
      const message = result.error || 'Virtual try-on did not return an image. Please try again.';
      setTryOnImage(null);
      setUploadError(message);
      if (isGenderMismatchUploadError(message)) appendCoachAssistantMessage(message);
      if (!isValidationBlockingUploadError(message)) {
        applySkinToneResult(await pendingSkinTone);
      }
    } catch (error) {
      setOutfitStep('idle');
      console.error('Fetch Error Detail:', error);
      const message = error instanceof Error ? error.message : 'Virtual try-on failed. Please try another photo.';
      setTryOnImage(null);
      setUploadError(message);
      if (!isValidationBlockingUploadError(message)) {
        applySkinToneResult(await pendingSkinTone);
      }
    } finally {
      setIsUploading(false);
    }
  };

  const handleImageChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    const allowedMimeTypes = new Set([
      'image/png',
      'image/jpeg',
      'image/jpg',
      'image/webp',
      'image/avif'
    ]);
    const fileType = file.type.toLowerCase();
    const hasSupportedExtension = /\.(png|jpe?g|webp|avif)$/i.test(file.name);
    const isSupportedImage =
      (fileType.startsWith('image/') && allowedMimeTypes.has(fileType)) ||
      (!fileType && hasSupportedExtension);

    if (!isSupportedImage) {
      setUploadError('Please upload a valid image file (JPG, PNG, WEBP, or AVIF).');
      event.target.value = '';
      return;
    }

    const maxBytes = 10 * 1024 * 1024;
    if (file.size > maxBytes) {
      setUploadError('Image is too large. Please keep it under 10 MB.');
      event.target.value = '';
      return;
    }

    try {
      const normalized = await normalizeUploadForVton(file);
      setUploadSourceDimensions({ width: normalized.width, height: normalized.height });
      setUploadedImage(normalized.dataUrl);
      setTryOnImage(null);
      setUploadError('');
      void processUploadedImage(normalized.dataUrl, {
        width: normalized.width,
        height: normalized.height,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not process this image. Please try another file.';
      setUploadError(message);
    } finally {
      event.target.value = '';
    }
  };

  const handlePurchaseClick = async () => {
    if (isSavingPurchase) return;

    if (!onPurchase) {
      setPurchaseFeedback('');
      setPurchaseError('Sign in to save purchases and unlock recommendations.');
      return;
    }

    setIsSavingPurchase(true);
    setPurchaseFeedback('');
    setPurchaseError('');

    try {
      await onPurchase(product);
      setPurchaseFeedback('Purchase saved. Recommendations are updated in Collections.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not save purchase right now.';
      setPurchaseError(message);
    } finally {
      setIsSavingPurchase(false);
    }
  };

  const hasUserPreview = Boolean(tryOnImage || uploadedImage);
  const resultImage = tryOnImage;
  const basePreviewImage = uploadedImage || product?.image || null;

  // Outfit builder computed values
  const upperIds = new Set(['m1', 'm2', 'm3', 'w1', 'w2', 'w3']);
  const bottomIds = new Set(['m4', 'm5', 'm6', 'w4', 'w5', 'w6']);
  const isCurrentProductUpper = product ? upperIds.has(product.id) : false;
  
  // Respond to the Gender toggle in the Measurements card
  const activeGenderStr = gender === 'womens' ? 'Women' : 'Men';
  const builderItems = MOCK_PRODUCTS.filter((p) => p.gender === activeGenderStr);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[#f4eadc] font-sans text-[#5d4631] h-screen overflow-hidden selection:bg-[#ead8bf] selection:text-[#5d4631]">

      {/* Top Header */}
      <div className="flex-none bg-[#3a2c20] text-[#fffaf2] px-6 lg:px-8 py-3 lg:py-4 flex justify-between items-center text-[11px] md:text-[13px] font-bold tracking-widest uppercase shadow-md z-10 shrink-0">
        <button
          onClick={onBack}
          className="flex items-center gap-2 hover:opacity-70 transition-opacity"
        >
          <ChevronLeft size={20} strokeWidth={2} />
          <span>Collections</span>
        </button>

        <div className="text-[14px] md:text-[18px] tracking-[0.22em] text-[#e5dfd3]">
          Virtual Fit AI Studio
        </div>

        <div className="flex items-center gap-4">
          {previousProduct && onGoToPrevious && (
            <button
              onClick={onGoToPrevious}
              className="hidden md:flex items-center gap-1.5 bg-[#5d4631] hover:bg-[#7a5c3a] border border-[#8a5f3b] text-[#f4eadc] text-[10px] font-bold uppercase tracking-widest px-4 py-2 rounded-full transition-all duration-300 hover:scale-105 group"
              title={`Go back to ${previousProduct.name}`}
            >
              <ChevronLeft size={14} strokeWidth={2.5} className="group-hover:-translate-x-0.5 transition-transform" />
              <span className="max-w-[120px] truncate">{previousProduct.name}</span>
            </button>
          )}
          <div className="text-right leading-tight hidden md:block">
            <div className="block">Guest</div>
            <div className="text-[10px] text-[#b29572]">Size M</div>
          </div>
          <div className="w-9 h-9 rounded-full bg-[#5d4631] flex items-center justify-center font-bold text-[#fffaf2] text-[13px] border border-[#8a5f3b]">
            G
          </div>
        </div>
      </div>

      {/* Main Container - made it h-auto but min-h-0 so it expands */}
      <div className="flex-1 w-full max-w-[1700px] mx-auto p-3 lg:p-4 xl:p-5 flex flex-col lg:flex-row gap-3 xl:gap-4 h-[calc(100vh-76px)] items-stretch overflow-hidden">

        {/* LEFT COLUMN: Fit Profile */}
        <div className="w-full lg:w-[300px] xl:w-[340px] 2xl:w-[380px] flex flex-col gap-3 shrink-0 h-full min-h-0 overflow-y-auto no-scrollbar pr-0.5">

          {/* Card 1: Viewing */}
          <div className="bg-[#fffaf2] rounded-2xl p-3 shadow-sm border border-[#e5dfd3] shrink-0 flex items-start justify-between gap-2 overflow-hidden">
            <div className="flex flex-col min-w-0">
              <p className="text-[9px] font-bold text-[#8a5f3b] uppercase tracking-widest mb-1">Viewing</p>
              <h2 className="text-[16px] xl:text-[18px] font-medium text-[#5d4631] truncate serif leading-snug">{product ? product.name : 'Select a garment'}</h2>
              <div className="flex items-center gap-2 mt-1">
                {product && (
                  <>
                    <span className="text-[13px] xl:text-[15px] font-bold text-[#8a5f3b]">${product.price || '59.99'}</span>
                    <span className="bg-[#5d4631] text-[#fffaf2] text-[8px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider shrink-0">In Stock</span>
                  </>
                )}
              </div>
            </div>

            {hasUserPreview && (
              <div className="w-[3.5rem] h-[4.5rem] bg-[#fffcf8] border-[1.5px] border-[#d4c3b3] rounded-lg shadow-sm overflow-hidden flex flex-col shrink-0 animate-in fade-in duration-500 pointer-events-none self-center">
                <div className="bg-[#f4eadc] text-[#8a5f3b] text-[7px] font-bold uppercase tracking-[0.1em] text-center py-0.5 border-b-[1.5px] border-[#d4c3b3] leading-none">
                  Original
                </div>
                <div className="flex-1 p-0.5 flex items-center justify-center bg-[url('https://www.transparenttextures.com/patterns/cubes.png')] bg-[#8a5f3b]/[0.02]">
                  {product ? (
                    <img src={product.image} alt="Original product" className="max-w-full max-h-full object-contain mix-blend-multiply drop-shadow-sm" />
                  ) : (
                    <Shirt className="text-[#d4c3b3] w-1/2 h-1/2" />
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Card 1.5: Outfit Builder */}
          <div className="bg-[#fffaf2] rounded-2xl px-3 py-2.5 shadow-sm border border-[#e5dfd3] shrink-0">
            {/* Header row */}
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-1.5">
                {pairedProduct
                  ? <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse shrink-0" />
                  : <Layers size={10} className="text-[#8a5f3b] shrink-0" />}
                <span className="text-[9.5px] font-black text-[#8a5f3b] uppercase tracking-[0.18em]">
                  {!product ? 'Wardrobe' : pairedProduct ? 'Outfit Selected' : 'Pair With'}
                </span>
              </div>
              {/* Removed generic Remove button to support individual removal */}
            </div>

            {pairedProduct ? (
              /* ── Paired view: compact side-by-side ── */
              <div className="flex items-stretch gap-1.5">
                {/* Primary (current) product */}
                {product && (
                  <div className="relative flex-1 flex flex-col items-center gap-1 bg-[#f4eadc] rounded-xl border border-[#d4c3b3] p-1.5 group">
                    <button 
                      onClick={() => onSelectProduct?.(pairedProduct)}
                      className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-[#fffaf2] border border-[#d4c3b3] rounded-full flex items-center justify-center text-[#8a5f3b] opacity-0 group-hover:opacity-100 transition-opacity shadow-sm hover:bg-[#e5dfd3] hover:text-[#5d4631] z-10"
                      title="Remove from outfit"
                    >
                      <span className="text-[10px] font-black leading-none">✕</span>
                    </button>
                    <div className="w-8 h-14 flex items-center justify-center">
                      <img src={product.image} alt={product.name} className="w-full h-full object-contain mix-blend-multiply" />
                    </div>
                    <span className="text-[7px] font-black text-[#8a5f3b] uppercase tracking-wider">{upperIds.has(product.id) ? 'Top' : 'Bottom'}</span>
                    <span className="text-[7.5px] text-[#5d4631] font-semibold text-center leading-tight line-clamp-2 w-full">{product.name}</span>
                  </div>
                )}
                {/* Plus separator */}
                <div className="flex items-center justify-center px-0.5">
                  <span className="text-xs text-[#b29572] font-bold">+</span>
                </div>
                {/* Paired product */}
                <div className="relative flex-1 flex flex-col items-center gap-1 bg-[#f0e8da] rounded-xl border-2 border-[#8a5f3b] p-1.5 group">
                  <button 
                    onClick={() => setPairedProduct(null)}
                    className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-[#fffaf2] border border-[#8a5f3b] rounded-full flex items-center justify-center text-[#8a5f3b] opacity-0 group-hover:opacity-100 transition-opacity shadow-sm hover:bg-[#e5dfd3] hover:text-[#5d4631] z-10"
                    title="Remove from outfit"
                  >
                    <span className="text-[10px] font-black leading-none">✕</span>
                  </button>
                  <div className="w-8 h-14 flex items-center justify-center">
                    <img src={pairedProduct.image} alt={pairedProduct.name} className="w-full h-full object-contain mix-blend-multiply" />
                  </div>
                  <span className="text-[7px] font-black text-[#8a5f3b] uppercase tracking-wider">{upperIds.has(pairedProduct.id) ? 'Top' : 'Bottom'}</span>
                  <span className="text-[7.5px] text-[#5d4631] font-semibold text-center leading-tight line-clamp-2 w-full">{pairedProduct.name}</span>
                </div>
              </div>
            ) : (
              /* ── Picker: horizontal portrait strip ── */
              <div className="flex gap-2 overflow-x-auto no-scrollbar py-0.5">
                {builderItems.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => {
                      if (!product) {
                        onSelectProduct?.(item);
                      } else {
                        const isItemTop = upperIds.has(item.id);
                        const isProductTop = upperIds.has(product.id);
                        if (isItemTop === isProductTop) {
                          onSelectProduct?.(item);
                        } else {
                          setPairedProduct(item);
                        }
                      }
                    }}
                    className="flex flex-col items-center gap-1 shrink-0 bg-[#f4eadc] rounded-xl border border-[#d4c3b3] px-2 py-2 w-[72px] hover:border-[#8a5f3b] hover:bg-[#ede0ce] hover:-translate-y-0.5 transition-all duration-200 group"
                    title={item.name}
                  >
                    <div className="w-9 h-12 flex items-center justify-center">
                      <img src={item.image} alt={item.name} className="w-full h-full object-contain mix-blend-multiply group-hover:scale-110 transition-transform duration-300" />
                    </div>
                    <span className="text-[7px] font-bold text-[#5d4631] text-center leading-tight line-clamp-2 w-full">{item.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Card 2: Measurements */}
          <div className="bg-[#fffaf2] rounded-2xl p-3 shadow-sm border border-[#e5dfd3] flex flex-col flex-1 min-h-0">
            <p className="text-[10px] font-bold text-[#8a5f3b] uppercase tracking-widest mb-2 shrink-0">Measurements</p>

            {/* Gender Toggle */}
            <div className="flex bg-[#e5dfd3] p-1 rounded-full border border-[#d4c3b3] mb-2 shrink-0">
              <button
                onClick={() => setGender('womens')}
                className={`flex-1 text-[9px] font-bold uppercase py-1.5 rounded-full transition-colors ${gender === 'womens' ? 'bg-[#5d4631] text-[#fffaf2]' : 'text-[#8a5f3b] hover:bg-[#fffaf2]'}`}
              >
                Women's
              </button>
              <button
                onClick={() => setGender('mens')}
                className={`flex-1 text-[9px] font-bold uppercase py-1.5 rounded-full transition-colors ${gender === 'mens' ? 'bg-[#5d4631] text-[#fffaf2]' : 'text-[#8a5f3b] hover:bg-[#fffaf2]'}`}
              >
                Men's
              </button>
            </div>

            <div className="flex-1 flex flex-col gap-1.5 min-h-0">
              {/* Weight & Skin Tone */}
              <div className="flex gap-3 shrink-0 mb-0.5">
                <div className="flex-1 flex flex-col">
                  <label className="text-[8.5px] font-bold text-[#8a5f3b] uppercase tracking-widest mb-0.5 flex items-center gap-1">
                    Weight (kg)
                  </label>
                  <p className="text-[7px] text-[#9b7e5d] mb-0.5 leading-none max-h-[10px]">Example: 70</p>
                  <div className="bg-[#f4eadc] rounded-lg border border-[#d4c3b3] px-2 py-1.5 flex items-center">
                    <input
                      type="number"
                      value={weight}
                      onChange={(e) => {
                        const next = e.target.value;
                        const sanitized = next.replace('-', '');
                        if (sanitized === '' || /^\d*\.?\d*$/.test(sanitized)) {
                          setWeight(sanitized);
                        }
                      }}
                      placeholder="70"
                      min="0"
                      step="0.1"
                      className="bg-transparent w-full outline-none text-[12px] text-[#5d4631] placeholder:text-[#b29572]"
                    />
                  </div>
                </div>
                <div className="flex-1 flex flex-col">
                  <label className="text-[8.5px] font-bold text-[#8a5f3b] uppercase tracking-widest mb-0.5">Skin Tone</label>
                  <p className="text-[7px] text-[#9b7e5d] mb-0.5 leading-none max-h-[10px]">Select option</p>
                  <div className="bg-[#f4eadc] rounded-lg border border-[#d4c3b3] px-2 py-1.5 relative">
                    <select
                      value={skinTone}
                      onChange={(e) => setSkinTone(e.target.value)}
                      className="bg-transparent w-full outline-none text-[12px] text-[#5d4631] appearance-none cursor-pointer"
                    >
                      <option value="Fair">Fair</option>
                      <option value="Light">Light</option>
                      <option value="Medium">Medium</option>
                      <option value="Olive">Olive</option>
                      <option value="Tan">Tan</option>
                      <option value="Dark">Dark</option>
                      <option value="Deep">Deep</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* Height */}
              <div className="flex flex-col shrink-0 mb-0.5">
                <label className="text-[8.5px] font-bold text-[#8a5f3b] uppercase tracking-widest mb-1">Height (ft / in)</label>
                <div className="flex gap-3">
                  <div className="flex-1 bg-[#f4eadc] rounded-lg border border-[#d4c3b3] px-2 py-1.5 flex items-center">
                    <input
                      type="number"
                      value={heightFeet}
                      onChange={(e) => setHeightFeet(e.target.value)}
                      placeholder="5"
                      min="0"
                      step="1"
                      className="bg-transparent w-full outline-none text-[12px] text-[#5d4631] placeholder:text-[#b29572]"
                    />
                    <span className="text-[8px] text-[#8a5f3b] font-bold ml-1">ft</span>
                  </div>
                  <div className="flex-1 bg-[#f4eadc] rounded-lg border border-[#d4c3b3] px-2 py-1.5 flex items-center">
                    <input
                      type="number"
                      value={heightInches}
                      onChange={(e) => {
                        const next = e.target.value;
                        if (next === '') {
                          setHeightInches('');
                          return;
                        }
                        const parsed = Number(next);
                        if (Number.isNaN(parsed)) return;
                        setHeightInches(String(Math.max(0, Math.min(11, Math.floor(parsed)))));
                      }}
                      placeholder="8"
                      min="0"
                      max="11"
                      step="1"
                      className="bg-transparent w-full outline-none text-[12px] text-[#5d4631] placeholder:text-[#b29572]"
                    />
                    <span className="text-[8px] text-[#8a5f3b] font-bold ml-1">in</span>
                  </div>
                </div>
              </div>

              <div className="flex-1 min-h-[34px] bg-[#f4eadc]/50 rounded-lg border border-[#d4c3b3] border-dashed flex items-center justify-center shrink-0 py-1.5 px-2">
                {!sizeResult && !sizeError && !isCalculatingSize && (
                  <span className="text-[8.5px] uppercase tracking-widest text-[#b29572] font-bold text-center leading-tight">
                    Fill details & click recommend size & color to see match
                  </span>
                )}

                {isCalculatingSize && (
                  <span className="text-[8.5px] uppercase tracking-widest text-[#8a5f3b] font-bold text-center leading-tight">
                    Calculating your best fit...
                  </span>
                )}

                {sizeError && !isCalculatingSize && (
                  <span className="text-[8.5px] text-red-600 font-bold text-center leading-tight">
                    {sizeError}
                  </span>
                )}

                {sizeResult && !isCalculatingSize && !sizeError && (
                  <div className="text-center">
                    <div className="text-[14px] font-bold text-[#5d4631] tracking-wider leading-none mb-0.5">Size {sizeResult.calculated_size}</div>
                    <div className="text-[7.5px] text-[#8a5f3b] leading-tight line-clamp-3">{sizeResult.size_explanation}</div>
                  </div>
                )}
              </div>

              {/* Recommend Size Button */}
              <button
                onClick={handleRecommendSize}
                disabled={isCalculatingSize || !product}
                className="w-full mt-auto bg-[#e5dfd3] border border-[#b29572] text-[#5d4631] text-[9.5px] font-bold tracking-[0.16em] uppercase py-2 rounded-lg hover:bg-[#d4c3b3] transition-colors flex items-center justify-center shrink-0 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {isCalculatingSize ? 'Calculating...' : 'Recommend Size & Color →'}
              </button>
            </div>
          </div>

          <button
            onClick={handlePurchaseClick}
            disabled={isSavingPurchase || !product}
            className="w-full bg-[#7d6244] text-[#fffaf2] text-[11px] font-bold tracking-[0.2em] uppercase py-3 rounded-[18px] hover:bg-[#5d4631] transition-colors shadow-md shrink-0 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {isSavingPurchase ? 'Saving Purchase...' : 'Add to Cart & Purchase'}
          </button>
          {purchaseFeedback && (
            <p className="text-[10px] text-[#2c6b3f] font-semibold text-center -mt-2">{purchaseFeedback}</p>
          )}
          {purchaseError && (
            <p className="text-[10px] text-[#8b2f24] font-semibold text-center -mt-2">{purchaseError}</p>
          )}
        </div>

        {/* CENTER COLUMN: Visual Studio */}
        <div className="flex-1 min-w-0 flex flex-col items-center justify-start gap-2 shrink relative bg-[#e5dfd3]/50 rounded-[3rem] p-3 lg:p-4 xl:p-5 shadow-sm border-2 border-[#d4c3b3]/70 min-h-0 overflow-x-hidden overflow-y-auto no-scrollbar">

          {/* Main Huge Image Area */}
          <div className="w-full bg-[#fffaf2] rounded-[1.75rem] overflow-hidden flex flex-col relative shadow-sm border-[2.5px] border-[#d4c3b3] group cursor-pointer h-[65vh] min-h-[400px] max-h-[700px] lg:h-[70vh] lg:max-h-[850px] xl:h-[75vh] xl:max-h-[900px]">
            <div className="flex-1 w-full flex items-center justify-center bg-[url('https://www.transparenttextures.com/patterns/cubes.png')] bg-[#8a5f3b]/[0.03] min-h-0 h-full relative overflow-hidden">

              {/* Base preview: uploaded photo or product image (hidden when result is ready) */}
              {basePreviewImage && !resultImage ? (
                <img
                  src={basePreviewImage}
                  alt={product?.name || 'Placeholder'}
                  className={`absolute inset-0 w-full h-full object-contain object-center drop-shadow-xl transition-transform duration-500 ${!uploadedImage ? 'mix-blend-multiply' : ''}`}
                />
              ) : null}

              {/* VTON result: auto-cropped so subject fills canvas, perfectly centered */}
              {resultImage ? (
                <img
                  key={resultImage}
                  src={resultImage}
                  alt="Generated try-on result"
                  className="absolute inset-0 w-full h-full object-contain object-center drop-shadow-2xl animate-in fade-in duration-700"
                />
              ) : null}

              {!basePreviewImage && !resultImage ? (
                <div className="w-full h-full flex items-center justify-center">
                  <Shirt className="text-[#d4c3b3] w-1/4 h-1/4 animate-pulse duration-1000" />
                </div>
              ) : null}

            </div>

            {!resultImage && (
              <div className="absolute bottom-0 left-0 w-full flex flex-col items-center justify-end pb-4 group-hover:pb-5 transition-all bg-gradient-to-t from-[#fffaf2]/85 via-[#fffaf2]/35 to-transparent">
                <Camera size={24} strokeWidth={1.5} className="text-[#5d4631] mb-1.5 group-hover:scale-110 transition-transform drop-shadow-md" />
                <span className="text-[#5d4631] text-[11px] font-bold tracking-[0.14em] uppercase drop-shadow-sm">Upload for virtual try-on</span>
              </div>
            )}
          </div>

          <div className="w-full px-2 shrink-0">
            {/* Upload CTA */}
            <div className="flex flex-col items-center gap-1.5">
              <button
                onClick={handleUploadClick}
                disabled={isUploading || !product}
                className="bg-[#fffaf2] border border-[#b29572] text-[#5d4631] text-[11px] font-bold uppercase tracking-[0.18em] py-1.5 px-8 rounded-full hover:bg-[#ede0ce] shadow-[0_4px_10px_rgba(93,70,49,0.1)] transition-all z-10 mt-1 shrink-0 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {isUploading
                  ? pairedProduct ? `Generating outfit... ${Math.min(uploadElapsedSec, 90)}s` : `Generating... ${Math.min(uploadElapsedSec, 90)}s`
                  : pairedProduct ? 'Try On Full Outfit' : 'Upload Photo'}
              </button>

              {isUploading && (
                <div className="w-full max-w-[560px] bg-[#fffaf2] border border-[#d4c3b3] rounded-xl px-3 py-2.5 shadow-sm">
                  <div className="flex items-center gap-2 mb-2">
                    <Loader2 size={14} className="text-[#8a5f3b] animate-spin shrink-0" />
                    <p className="text-[10px] font-semibold text-[#5d4631]">
                      AI generation is running. High-res output can take up to 90 seconds.
                    </p>
                  </div>
                  <div className="w-full h-2 rounded-full bg-[#e5dfd3] overflow-hidden border border-[#d4c3b3]">
                    <div
                      className="h-full bg-[#8a5f3b] transition-all duration-500"
                      style={{ width: `${uploadProgressPct}%` }}
                    />
                  </div>
                  <p className="text-[9px] text-[#8a5f3b] mt-1">{Math.min(uploadElapsedSec, 90)}s / 90s</p>
                </div>
              )}

              {/* Outfit step progress indicator */}
              {isUploading && pairedProduct && (
                <div className="flex flex-col gap-1 w-full max-w-[300px] bg-[#fffaf2] border border-[#d4c3b3] rounded-2xl px-4 py-2.5 shadow-sm">
                  <p className="text-[9px] font-bold text-[#8a5f3b] uppercase tracking-widest mb-1">Building Your Look</p>
                  <div className="flex items-center gap-2">
                    <span className={`w-3 h-3 rounded-full shrink-0 transition-all ${
                      outfitStep === 'step1' || outfitStep === 'step2' ? 'bg-[#8a5f3b] animate-pulse' :
                      outfitStep === 'idle' && tryOnImage ? 'bg-emerald-500' :
                      'bg-[#d4c3b3]'
                    }`} />
                    <span className={`text-[10px] font-semibold ${
                      outfitStep === 'step1' || outfitStep === 'step2' ? 'text-[#5d4631]' : 'text-[#b29572]'
                    }`}>
                      {outfitStep === 'step1'
                        ? 'Step 1/2: applying top...'
                        : outfitStep === 'step2'
                          ? 'Step 2/2: applying bottom...'
                          : outfitStep === 'idle' && tryOnImage
                            ? 'Two-step outfit render complete ✓'
                            : 'Preparing...'}
                    </span>
                  </div>
                </div>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/jpg,image/webp,image/avif"
                className="hidden"
                onChange={handleImageChange}
              />

              {uploadError && (
                <div className="w-full max-w-[560px] bg-[#fff3ef] border border-[#efc4b7] rounded-xl px-3 py-1.5 flex items-center gap-2 shadow-sm">
                  <AlertTriangle size={14} className="text-[#b7442a] shrink-0" />
                  <p className="text-[9px] leading-snug text-[#8b2f24] font-semibold">{uploadError}</p>
                </div>
              )}
            </div>

            {/* For Best Results */}
            <div className="mt-1 bg-[#f9f2e8] border border-[#d9c8b0] rounded-xl px-2 py-1.5">
              <div className="flex items-center gap-2 mb-1">
                <div className="h-px flex-1 bg-gradient-to-r from-transparent to-[#d4c3b3]" />
                <p className="text-[8px] font-bold text-[#8a5f3b] uppercase tracking-[0.2em]">For Best Results</p>
                <div className="h-px flex-1 bg-gradient-to-l from-transparent to-[#d4c3b3]" />
              </div>

              <div className="grid grid-cols-3 gap-1 w-full items-stretch">
                <div className="flex flex-col items-center justify-center bg-[#fffaf2] rounded-lg p-1.5 w-full text-center border border-[#d4c3b3] shadow-sm">
                  <User size={14} strokeWidth={1.6} className="text-[#8a5f3b] mb-0.5" />
                  <span className="text-[8px] text-[#7a5f44] leading-tight font-semibold">Full-body front-facing photo</span>
                </div>
                <div className="flex flex-col items-center justify-center bg-[#fffaf2] rounded-lg p-1.5 w-full text-center border border-[#d4c3b3] shadow-sm">
                  <Smartphone size={14} strokeWidth={1.6} className="text-[#8a5f3b] mb-0.5" />
                  <span className="text-[8px] text-[#7a5f44] leading-tight font-semibold">Vertical portrait orientation</span>
                </div>
                <div className="flex flex-col items-center justify-center bg-[#fffaf2] rounded-lg p-1.5 w-full text-center border border-[#d4c3b3] shadow-sm">
                  <Sun size={14} strokeWidth={1.6} className="text-[#8a5f3b] mb-0.5" />
                  <span className="text-[8px] text-[#7a5f44] leading-tight font-semibold">Good lighting &amp; plain background</span>
                </div>
              </div>

              <p className="text-[8px] text-[#9a7f62] mt-1 text-center tracking-[0.14em] uppercase">JPG, PNG, WEBP or AVIF · Max 10 MB</p>
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN: AI Coach */}
        <div className="w-full lg:w-[300px] xl:w-[330px] 2xl:w-[360px] flex flex-col gap-4 shrink-0 h-full min-h-0 overflow-hidden">

          {/* Colour Lab */}
          <div className="bg-[#fffaf2] rounded-[2rem] p-4 xl:p-5 shadow-sm border border-[#e5dfd3] relative shrink-0">
            <Wand2 size={20} strokeWidth={1.5} className="absolute right-5 top-5 text-[#8a5f3b]" />
            <p className="text-[11px] font-bold text-[#8a5f3b] uppercase tracking-widest mb-3">Colour Lab</p>

            <div className="flex justify-between gap-2 mb-3">
              {((detectedColors.length > 0 ? detectedColors : sizeResult?.color_recommendations?.recommended_colors)?.slice(0, 5) || ['-', '-', '-', '-', '-']).map((color, i) => (
                <div
                  key={`${color}-${i}`}
                  className="flex-1 aspect-[4/3] rounded-2xl border border-[#d4c3b3] transition-colors cursor-pointer flex items-center justify-center px-1"
                  title={`${color} ${color !== '-' ? `(${colorToHex(color)})` : ''}`}
                  style={{ backgroundColor: color === '-' ? '#f4eadc' : colorToHex(color) }}
                >
                  {color === '-' ? (
                    <span className="text-[9px] text-[#8a5f3b] font-bold text-center leading-tight truncate w-full">-</span>
                  ) : (
                    <span className="text-[8px] text-white font-bold text-center leading-tight px-1 py-0.5 rounded bg-black/40">
                      {color}
                    </span>
                  )}
                </div>
              ))}
            </div>

            <p className="text-[10px] text-[#8a5f3b] text-center italic tracking-wider">
              {detectedTone
                ? `Detected ${detectedTone} skin tone · personalized colors ready`
                : sizeResult
                  ? 'Personalized color recommendations ready'
                  : 'Calculate size to see colour recommendations'}
            </p>
          </div>

          {/* AI Size Coach */}
          <div className="bg-[#fffaf2] rounded-[2rem] p-4 xl:p-5 shadow-sm border border-[#e5dfd3] flex-1 flex flex-col relative min-h-0 overflow-hidden">
            <div className="flex items-center gap-2 mb-4 shrink-0">
              <div className="w-2 h-2 rounded-full bg-[#5d4631]"></div>
              <p className="text-[11px] font-bold text-[#8a5f3b] uppercase tracking-widest">AI Size Coach</p>
            </div>

            <div className="flex-1 overflow-y-auto pr-2 no-scrollbar flex flex-col gap-4 min-h-0 mb-4">
              {/* Chat Messages */}
              {coachMessages.map((msg, index) => {
                const isPairingMsg = Boolean(msg.pairedProducts && msg.pairedProducts.length > 0);
                const isLastPairing = isPairingMsg && index === coachMessages.length - 1;
                return (
                <div
                  key={`coach-msg-${index}`}
                  ref={isLastPairing ? pairingMsgRef : null}
                  className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : ''}`}
                >
                  {msg.role === 'assistant' && (
                    <div className="w-9 h-9 rounded-full bg-[#f4eadc] border border-[#d4c3b3] flex items-center justify-center shrink-0 shadow-sm mt-0.5">
                      {msg.pairedProducts ? <Layers size={16} className="text-[#8a5f3b]" /> : <Sparkles size={16} className="text-[#b29572]" />}
                    </div>
                  )}
                  <div
                    className={
                      msg.role === 'assistant'
                        ? 'max-w-[92%] bg-[#e5dfd3] border border-[#d4c3b3] rounded-3xl rounded-tl-none p-3.5 text-[11px] xl:text-[12px] leading-relaxed text-[#5d4631] shadow-sm'
                        : 'max-w-[88%] bg-[#5d4631] border border-[#8a5f3b] rounded-3xl rounded-tr-none p-3.5 text-[11px] xl:text-[12px] leading-relaxed text-[#fffaf2] shadow-sm'
                    }
                  >
                    {msg.content}
                    {msg.pairedProducts && msg.pairedProducts.length > 0 && (
                      <div className="mt-3 flex flex-col gap-2">
                        {msg.pairedProducts.map((p) => (
                          <button
                            key={`pair-${p.id}`}
                            onClick={() => onSelectProduct ? onSelectProduct(p) : undefined}
                            className="flex items-center gap-3 bg-[#fffaf2] border border-[#d4c3b3] rounded-2xl p-2 hover:border-[#8a5f3b] hover:shadow-md transition-all duration-300 group text-left w-full cursor-pointer"
                            title={`Try on ${p.name}`}
                          >
                            <div className="w-10 h-10 rounded-xl bg-[#f4eadc] border border-[#d4c3b3] overflow-hidden shrink-0 flex items-center justify-center">
                              <img src={p.image} alt={p.name} className="w-full h-full object-cover mix-blend-multiply" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-[10px] font-bold text-[#5d4631] truncate leading-tight">{p.name}</p>
                              <p className="text-[9px] text-[#8a5f3b] leading-tight">${p.price}</p>
                            </div>
                            <span className="text-[9px] font-bold text-[#8a5f3b] uppercase tracking-wider shrink-0 group-hover:text-[#5d4631] transition-colors pr-1">Try →</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                );
              })}

              {isCoachLoading && (
                <div className="flex gap-3">
                  <div className="w-9 h-9 rounded-full bg-[#f4eadc] border border-[#d4c3b3] flex items-center justify-center shrink-0 shadow-sm mt-0.5">
                    <Sparkles size={16} className="text-[#b29572]" />
                  </div>
                  <div className="bg-[#e5dfd3] border border-[#d4c3b3] rounded-3xl rounded-tl-none p-3.5 text-[11px] leading-relaxed text-[#8a5f3b] shadow-sm">
                    Thinking...
                  </div>
                </div>
              )}
              <div ref={chatEndRef} />

              {/* Quick Replies */}
              <div className="flex flex-wrap gap-2 ml-12">
                {quickReplies.map((reply) => (
                  <button
                    key={reply}
                    onClick={() => {
                      setSelectedFit(reply);
                      sendCoachMessage(reply, reply);
                    }}
                    disabled={isCoachLoading}
                    className={`px-4 py-2 border rounded-full text-[10px] text-[#8a5f3b] font-bold tracking-wider transition-colors disabled:opacity-60 disabled:cursor-not-allowed ${selectedFit === reply ? 'bg-[#e5dfd3] border-[#b29572] shadow-sm text-[#5d4631]' : 'bg-transparent border-[#d4c3b3] hover:bg-[#e5dfd3]'}`}
                  >
                    {reply}
                  </button>
                ))}
              </div>
            </div>

            {/* Chat Input */}
            <div className="relative shrink-0 mt-auto">
              <input
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    sendCoachMessage();
                  }
                }}
                placeholder="Ask your AI coach..."
                className="w-full bg-[#f4eadc] border border-[#d4c3b3] rounded-full py-3 px-4 pr-12 text-[11px] xl:text-[12px] text-[#5d4631] placeholder:text-[#b29572] focus:outline-none focus:border-[#b29572] transition-colors shadow-sm"
              />
              <button
                onClick={() => sendCoachMessage()}
                disabled={isCoachLoading || !chatInput.trim()}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-[#8a5f3b] hover:text-[#5d4631] transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
              >
                <Send size={18} strokeWidth={1.5} />
              </button>
            </div>

            {/* Bottom-right brain/floating icon representation */}
            <div className="absolute right-4 bottom-4 w-12 h-12 bg-[#e5dfd3] rounded-full border border-[#d4c3b3] shadow-md flex items-center justify-center text-[#8a5f3b] z-10 shrink-0 hover:scale-110 transition-transform cursor-pointer">
              <Sparkles size={20} />
            </div>
          </div>

        </div>

      </div>

    </div>
  );
};

export default StudioView;
