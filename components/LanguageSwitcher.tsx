import { useState } from 'react';
import { useLanguage } from '../lib/contexts/LanguageContext';
import { languages } from '../lib/i18n-config';

const languageNames: Record<string, { native: string, flag: string }> = {
  ru: {
    native: 'Русский',
    flag: '🇷🇺'
  },
  de: {
    native: 'Deutsch',
    flag: '🇩🇪'
  }
};

export default function LanguageSwitcher() {
  const { language, changeLanguage } = useLanguage();
  const [isOpen, setIsOpen] = useState(false);
  
  return (
    <div className="relative">
      <button
        type="button"
        className="flex items-center px-3 py-1.5 text-sm font-medium rounded-md hover:bg-gray-100 focus:outline-none"
        onClick={() => setIsOpen(!isOpen)}
      >
        <span className="mr-1">{languageNames[language]?.flag}</span>
        <span className="hidden sm:inline">{languageNames[language]?.native}</span>
        <svg 
          className="w-4 h-4 ml-1" 
          fill="none" 
          stroke="currentColor" 
          viewBox="0 0 24 24" 
          xmlns="http://www.w3.org/2000/svg"
        >
          <path 
            strokeLinecap="round" 
            strokeLinejoin="round" 
            strokeWidth={2} 
            d="M19 9l-7 7-7-7" 
          />
        </svg>
      </button>
      
      {isOpen && (
        <div className="absolute right-0 mt-2 w-40 rounded-md shadow-lg bg-white ring-1 ring-black ring-opacity-5 z-10">
          <div 
            className="py-1" 
            role="menu" 
            aria-orientation="vertical" 
            aria-labelledby="language-menu"
          >
            {languages.map((lng) => (
              <button
                key={lng}
                className={`block w-full text-left px-4 py-2 text-sm ${language === lng ? 'bg-gray-100 text-gray-900' : 'text-gray-700'} hover:bg-gray-100`}
                role="menuitem"
                onClick={() => {
                  changeLanguage(lng);
                  setIsOpen(false);
                }}
              >
                <span className="mr-2">{languageNames[lng]?.flag}</span>
                {languageNames[lng]?.native}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
