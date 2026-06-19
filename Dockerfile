FROM node:18-alpine

WORKDIR /app

# Копируем только package.json для кэширования слоев при установке зависимостей
COPY package.json ./

# Установка без native модулей
RUN npm install --ignore-scripts

# Копируем остальные файлы проекта
COPY . .

# Экспозиция порта
EXPOSE 3000

# Запуск приложения в режиме разработки
CMD ["npm", "run", "dev"]
