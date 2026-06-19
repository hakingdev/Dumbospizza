"use client";

import { useEffect, useState } from 'react';
import { useLanguage } from '../lib/contexts/LanguageContext';
import { loadTranslation } from '../lib/i18n';

interface TranslationProviderProps {
  children: React.ReactNode;
}

// Компонент-провайдер для инициализации переводов
export default function TranslationProvider({ children }: TranslationProviderProps) {
  const { language } = useLanguage();
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    const initTranslation = async () => {
      await loadTranslation(language);
      setIsLoaded(true);
    };
    
    initTranslation();
  }, [language]);

  if (!isLoaded) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="inline-block animate-spin h-8 w-8 border-4 border-gray-400 rounded-full border-t-primary-600"></div>
          <p className="mt-2 text-gray-600">Загрузка...</p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
