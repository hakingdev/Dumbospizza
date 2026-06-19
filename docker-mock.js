// Модуль для мокирования нативных зависимостей для Docker
// Это поможет избежать проблем с компиляцией нативных модулей на Windows

const fs = require('fs');
const path = require('path');

// Находим проблемные модули и создаем для них заглушки
const problematicModules = [
  'usb',
  'node-thermal-printer',
  'escpos',
  'escpos-usb'
];

// Создаем заглушки для проблемных модулей
console.log('Creating mocks for native modules in Docker...');

problematicModules.forEach(moduleName => {
  try {
    const modulePath = path.resolve('./node_modules', moduleName);
    
    // Проверяем существование модуля
    if (fs.existsSync(modulePath)) {
      console.log(`Mocking ${moduleName}...`);
      
      // Создаем mock файл
      const mockFile = path.join(modulePath, 'index.js');
      fs.writeFileSync(mockFile, `
        // Mock implementation for Docker on Windows
        module.exports = {
          // Базовые методы
          init: () => Promise.resolve(),
          getPrinters: () => [],
          getDefaultPrinter: () => null,
          execute: () => Promise.resolve(),
          setPrinter: () => {},
          mockMode: true,
          // USB-специфичные методы
          getDeviceList: () => [],
          findByIds: () => null,
          on: () => {},
          Device: function() { 
            return { 
              open: () => {}, 
              close: () => {},
              transferOut: () => Promise.resolve(),
              mockMode: true 
            }; 
          }
        };
      `);
      
      console.log(`Created mock for ${moduleName}`);
    }
  } catch (error) {
    console.error(`Error creating mock for ${moduleName}:`, error);
  }
});

console.log('All native modules mocked for Docker environment.');
