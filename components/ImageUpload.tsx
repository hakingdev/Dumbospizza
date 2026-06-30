"use client";

import { useEffect, useState } from 'react';
import { Upload, X, Loader2 } from 'lucide-react';
import { useLanguage } from '../lib/contexts/LanguageContext';
import { loadTranslation } from '../lib/i18n';
import { SafeImage } from './SafeImage';

interface ImageUploadProps {
  value: string;
  onChange: (url: string) => void;
  label?: string;
  folder?: 'products' | 'categories';
}

export default function ImageUpload({ value, onChange, label, folder = 'products' }: ImageUploadProps) {
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState(value);
  const { language } = useLanguage();
  const [t, setT] = useState<any>(() => (k: string, fallback?: string) => fallback ?? k);

  useEffect(() => {
    const loadTranslations = async () => {
      const { t: translation } = await loadTranslation(language);
      setT(() => translation);
    };

    loadTranslations();
  }, [language]);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith('image/')) {
      alert(t('image_upload.invalid_type', 'Пожалуйста, выберите изображение'));
      return;
    }

    setUploading(true);

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('folder', folder);

      const response = await fetch('/api/admin/upload', {
        method: 'POST',
        body: formData
      });

      const data = await response.json();

      if (response.ok && data.success) {
        onChange(data.path);
        setPreview(data.path);
      } else {
        const message = data.error || t('image_upload.error', 'Ошибка загрузки изображения');
        alert(message);
      }
      setUploading(false);
    } catch (error) {
      console.error('Error uploading image:', error);
      alert(t('image_upload.error', 'Ошибка загрузки изображения'));
      setUploading(false);
    }
  };

  const handleRemove = () => {
    onChange('');
    setPreview('');
  };

  return (
    <div>
      <label className="block text-sm font-medium mb-2">
        {label || t('image_upload.label', 'Изображение')}
      </label>
      
      {preview ? (
        <div className="relative inline-block">
          <SafeImage
            src={preview}
            alt="Preview"
            className="h-32 w-32 object-cover rounded-lg border"
          />
          <button
            onClick={handleRemove}
            className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-1 hover:bg-red-600"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : (
        <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center">
          <label className="cursor-pointer">
            <input
              type="file"
              accept="image/*"
              onChange={handleFileSelect}
              className="hidden"
              disabled={uploading}
            />
            {uploading ? (
              <div className="flex flex-col items-center">
                <Loader2 className="h-8 w-8 animate-spin text-primary-600 mb-2" />
                <span className="text-sm text-gray-600">{t('common.loading', 'Загрузка...')}</span>
              </div>
            ) : (
              <div className="flex flex-col items-center">
                <Upload className="h-8 w-8 text-gray-400 mb-2" />
                <span className="text-sm text-gray-600">{t('image_upload.click', 'Нажмите для загрузки')}</span>
                <span className="text-xs text-gray-400 mt-1">{t('image_upload.types', 'JPG, PNG до 5MB')}</span>
              </div>
            )}
          </label>
        </div>
      )}

      {preview && (
        <input
          type="text"
          value={preview}
          onChange={(e) => {
            setPreview(e.target.value);
            onChange(e.target.value);
          }}
          className="mt-2 w-full px-4 py-2 border rounded-lg text-sm"
          placeholder={t('image_upload.url_placeholder', 'Или введите URL изображения')}
        />
      )}
    </div>
  );
}

