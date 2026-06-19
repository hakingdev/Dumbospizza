"use client";

import React, { createContext, useContext, useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { languages, fallbackLng, cookieName } from '../i18n-config';
import { setCookie, getCookie } from 'cookies-next';

type LanguageContextType = {
  language: string;
  changeLanguage: (lng: string) => void;
};

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

export const LanguageProvider = ({ children }: { children: React.ReactNode }) => {
  const router = useRouter();
  const [language, setLanguage] = useState<string>(fallbackLng);

  useEffect(() => {
    // Всегда используем немецкий язык
    const detectedLng = fallbackLng;
    setLanguage(detectedLng);
    setCookie(cookieName, detectedLng, { maxAge: 60 * 60 * 24 * 30 }); // 30 дней
  }, []);

  const changeLanguage = (lng: string) => {
    if (languages.includes(lng)) {
      setLanguage(lng);
      setCookie(cookieName, lng, { maxAge: 60 * 60 * 24 * 30 }); // 30 дней
      
      // Перезагружаем текущую страницу для применения нового языка
      if (typeof window !== 'undefined') {
        window.location.reload();
      }
    }
  };

  const value = {
    language,
    changeLanguage
  };

  return (
    <LanguageContext.Provider value={value}>
      {children}
    </LanguageContext.Provider>
  );
};

export const useLanguage = () => {
  const context = useContext(LanguageContext);
  if (context === undefined) {
    throw new Error('useLanguage must be used within a LanguageProvider');
  }
  return context;
};
