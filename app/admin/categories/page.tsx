"use client";

import { useState, useEffect } from 'react';
import { Plus, Edit, Eye, EyeOff, Trash2, Save, X, Loader2 } from 'lucide-react';
import Link from 'next/link';
import ImageUpload from '../../../components/ImageUpload';
import { SafeImage } from '../../../components/SafeImage';

export default function CategoriesPage() {
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isEditing, setIsEditing] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    slug: '',
    description: '',
    image: '',
    icon: '',
    active: true,
    order: 0
  });

  useEffect(() => {
    fetchCategories();
  }, []);

  const fetchCategories = async () => {
    try {
      const response = await fetch('/api/categories?source=local');
      const data = await response.json();
      if (data.success) {
        setCategories(data.categories || []);
      }
    } catch (error) {
      console.error('Error:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleAdd = () => {
    setFormData({
      name: '',
      slug: '',
      description: '',
      image: '',
      icon: '',
      active: true,
      order: categories.length
    });
    setIsAdding(true);
    setIsEditing(null);
  };

  const handleEdit = (category: any) => {
    setFormData({
      name: category.name || '',
      slug: category.slug || '',
      description: category.description || '',
      image: category.image || '',
      icon: category.icon || '',
      active: category.active !== false,
      order: category.order || 0
    });
    setIsEditing(category._id);
    setIsAdding(false);
  };

  const handleSave = async () => {
    try {
      const url = isEditing 
        ? `/api/categories/${isEditing}`
        : '/api/categories';
      
      const method = isEditing ? 'PUT' : 'POST';
      
      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      });

      if (response.ok) {
        await fetchCategories();
        setIsAdding(false);
        setIsEditing(null);
        setFormData({
          name: '',
          slug: '',
          description: '',
          image: '',
          icon: '',
          active: true,
          order: 0
        });
      }
    } catch (error) {
      console.error('Error:', error);
      alert('Ошибка сохранения');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Удалить категорию?')) return;
    
    try {
      await fetch(`/api/categories/${id}`, { method: 'DELETE' });
      await fetchCategories();
    } catch (error) {
      console.error('Error:', error);
    }
  };

  const toggleActive = async (id: string, currentStatus: boolean) => {
    try {
      await fetch(`/api/categories/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: !currentStatus })
      });
      await fetchCategories();
    } catch (error) {
      console.error('Error:', error);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-primary-600" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <h1 className="text-2xl font-bold">Категории</h1>
        <button
          onClick={handleAdd}
          className="bg-primary-600 text-white px-4 py-2 rounded-lg hover:bg-primary-700 flex items-center justify-center w-full sm:w-auto"
        >
          <Plus className="h-5 w-5 mr-2" />
          Добавить категорию
        </button>
      </div>

      {/* Add/Edit Form */}
      {(isAdding || isEditing) && (
        <div className="bg-white rounded-lg shadow-sm p-6">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl font-bold">
              {isEditing ? 'Редактировать категорию' : 'Новая категория'}
            </h2>
            <button
              onClick={() => {
                setIsAdding(false);
                setIsEditing(null);
              }}
              className="text-gray-400 hover:text-gray-600"
            >
              <X className="h-6 w-6" />
            </button>
          </div>

          <div className="grid grid-cols-12 gap-4">
            <div className="col-span-12 md:col-span-6">
              <label className="block text-sm font-medium mb-2">Название *</label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({...formData, name: e.target.value, slug: e.target.value.toLowerCase().replace(/\s+/g, '-')})}
                className="w-full px-4 py-2 border rounded-lg"
                placeholder="Пицца"
              />
            </div>

            <div className="col-span-12 md:col-span-6">
              <label className="block text-sm font-medium mb-2">Slug (URL)</label>
              <input
                type="text"
                value={formData.slug}
                onChange={(e) => setFormData({...formData, slug: e.target.value})}
                className="w-full px-4 py-2 border rounded-lg"
                placeholder="pizza"
              />
            </div>

            <div className="col-span-12">
              <label className="block text-sm font-medium mb-2">Описание</label>
              <textarea
                value={formData.description}
                onChange={(e) => setFormData({...formData, description: e.target.value})}
                className="w-full px-4 py-2 border rounded-lg"
                rows={3}
              />
            </div>

            <div className="col-span-12 md:col-span-6">
              <label className="block text-sm font-medium mb-2">URL изображения</label>
              <input
                type="text"
                value={formData.image}
                onChange={(e) => setFormData({...formData, image: e.target.value})}
                className="w-full px-4 py-2 border rounded-lg"
                placeholder="/images/categories/pizza.jpg"
              />
            </div>

            <div className="col-span-12 md:col-span-6">
              <ImageUpload
                value={formData.icon}
                onChange={(url) => setFormData({...formData, icon: url})}
                label="Иконка категории (для главной страницы)"
                folder="categories"
              />
            </div>

            <div className="col-span-12 md:col-span-3">
              <label className="block text-sm font-medium mb-2">Порядок</label>
              <input
                type="number"
                value={formData.order}
                onChange={(e) => setFormData({...formData, order: parseInt(e.target.value)})}
                className="w-full px-4 py-2 border rounded-lg"
              />
            </div>

            <div className="col-span-12 md:col-span-3 flex items-end">
              <label className="flex items-center">
                <input
                  type="checkbox"
                  checked={formData.active}
                  onChange={(e) => setFormData({...formData, active: e.target.checked})}
                  className="mr-2"
                />
                <span className="text-sm">Активна</span>
              </label>
            </div>

            <div className="col-span-12">
              <button
                onClick={handleSave}
                className="bg-primary-600 text-white px-6 py-2 rounded-lg hover:bg-primary-700 flex items-center"
              >
                <Save className="h-5 w-5 mr-2" />
                Сохранить
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Categories List */}
      <div className="bg-white rounded-lg shadow-sm overflow-x-auto">
        <table className="min-w-[720px] w-full">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="px-4 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Название</th>
              <th className="px-4 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Slug</th>
              <th className="px-4 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Порядок</th>
              <th className="px-4 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Статус</th>
              <th className="px-4 sm:px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Действия</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {categories.map((category: any) => (
              <tr key={category._id} className="hover:bg-gray-50">
                <td className="px-4 sm:px-6 py-4">
                  <div className="flex items-center">
                    {category.icon ? (
                      <SafeImage src={category.icon} alt={category.name} className="h-10 w-10 object-contain rounded mr-3" />
                    ) : category.image ? (
                      <SafeImage src={category.image} alt={category.name} className="h-10 w-10 rounded mr-3" />
                    ) : null}
                    <div>
                      <div className="font-medium">{category.name}</div>
                      {category.description && (
                        <div className="text-sm text-gray-500">{category.description.substring(0, 50)}</div>
                      )}
                    </div>
                  </div>
                </td>
                <td className="px-4 sm:px-6 py-4 text-sm text-gray-500">{category.slug}</td>
                <td className="px-4 sm:px-6 py-4 text-sm">{category.order || 0}</td>
                <td className="px-4 sm:px-6 py-4">
                  <span className={`px-2 py-1 text-xs rounded ${
                    category.active !== false ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                  }`}>
                    {category.active !== false ? 'Активна' : 'Скрыта'}
                  </span>
                </td>
                <td className="px-4 sm:px-6 py-4 text-right">
                  <div className="flex items-center justify-end gap-2">
                    <button
                      onClick={() => toggleActive(category._id, category.active !== false)}
                      className="text-gray-600 hover:text-primary-600"
                    >
                      {category.active !== false ? <Eye className="h-5 w-5" /> : <EyeOff className="h-5 w-5" />}
                    </button>
                    <button
                      onClick={() => handleEdit(category)}
                      className="text-gray-600 hover:text-primary-600"
                    >
                      <Edit className="h-5 w-5" />
                    </button>
                    <button
                      onClick={() => handleDelete(category._id)}
                      className="text-gray-600 hover:text-red-600"
                    >
                      <Trash2 className="h-5 w-5" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {categories.length === 0 && (
          <div className="text-center py-12 text-gray-500">
            Категории не найдены
          </div>
        )}
      </div>
    </div>
  );
}

