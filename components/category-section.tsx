"use client"

import Image from 'next/image'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useLanguage } from '../lib/contexts/LanguageContext'
import { loadTranslation } from '../lib/i18n'

interface CategorySectionProps {
  title: string;
  image: string;
  href: string;
}

export function CategorySection({ title, image, href }: CategorySectionProps) {
  const { language } = useLanguage()
  const [t, setT] = useState<any>(() => (k: string) => k)

  useEffect(() => {
    const loadTranslations = async () => {
      const { t: translation } = await loadTranslation(language)
      setT(() => translation)
    }

    loadTranslations()
  }, [language])

  return (
    <Link 
      href={href}
      className="group block card overflow-hidden"
    >
      <div className="relative h-40 w-full overflow-hidden rounded-md">
        {/* In a real app, this would use next/image with actual images */}
        <div className="absolute inset-0 bg-gray-200 flex items-center justify-center text-gray-500">
          [{t('category.image_placeholder', 'Изображение')} {title}]
        </div>
      </div>
      <h3 className="mt-4 text-lg font-semibold group-hover:text-primary-600">{title}</h3>
    </Link>
  )
}
