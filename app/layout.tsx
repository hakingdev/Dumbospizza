import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import { Header } from '../components/header'
import { Footer } from '../components/footer'
import Script from 'next/script'
import TranslationProvider from '../components/TranslationProvider'
import { Analytics } from '@vercel/analytics/react'
import Providers from '../components/Providers'
import ConsentScripts from '../components/ConsentScripts'
import { consentBootstrapScript } from '../lib/consent'
import { SITE_URL } from '../lib/site-url'
import { connectToDatabase } from '../lib/models'
import { getSetting } from '../lib/settings'
import { resolveOrderAcceptanceHours } from '../lib/order-acceptance-hours'

const inter = Inter({ subsets: ['latin', 'cyrillic'] })
const siteUrl = SITE_URL

export const viewport = {
  width: 'device-width',
  initialScale: 1
}

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: 'Dumbos Pizza | Pizza bestellen in Bad Kissingen | Lieferservice 97688',
  description: 'Bestellen Sie leckere Pizza in Bad Kissingen. Schnelle Lieferung, große Auswahl, Treueprogramm. ✓ Lieferservice 97688 ✓ Online bestellen ✓ Kontaktlose Lieferung',
  keywords: 'Pizza bestellen Bad Kissingen, Lieferservice 97688, Pizza Lieferservice, Pizza online bestellen, Pizza Bad Kissingen, Garitz, Hausen, Arnshausen, Reiterswiesen, Winkels',
  openGraph: {
    type: 'website',
    locale: 'de_DE',
    url: `${siteUrl}/`,
    title: 'Dumbos Pizza | Pizza bestellen in Bad Kissingen',
    description: 'Bestellen Sie leckere Pizza in Bad Kissingen. Schnelle Lieferung, große Auswahl, Treueprogramm.',
    siteName: 'Dumbos Pizza Bad Kissingen'
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true
    }
  },
  alternates: {
    canonical: siteUrl
  },
  verification: {
    google: 'NfjrGA7NalYlQacHjnSWcd8iwPPtKD9jZXkOO81P-hQ'
  }
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // Часы приёма заказов для JSON-LD берём из настроек админки; при ошибке — дефолт.
  let orderHours = resolveOrderAcceptanceHours(null)
  try {
    await connectToDatabase()
    const storeSettings = await getSetting<Record<string, any>>('storeSettings', {})
    orderHours = resolveOrderAcceptanceHours(storeSettings)
  } catch (error) {
    console.error('Error loading store settings for structured data:', error)
  }

  return (
    <html lang="de">
      <head>
        <link rel="alternate" hrefLang="de" href={siteUrl} />
      </head>
      <body className={inter.className}>
        {/*
          Consent Mode v2: значения по умолчанию (всё denied) обязаны попасть в
          dataLayer ДО загрузки gtag.js, иначе первый хит уйдёт с cookies.
          Сами теги грузит <ConsentScripts /> — по решению пользователя.
        */}
        <Script
          id="consent-bootstrap"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{ __html: consentBootstrapScript() }}
        />
        <ConsentScripts />
        <Providers>
          <TranslationProvider>
            {children}
          </TranslationProvider>
        </Providers>
        {/* Vercel Analytics: cookieless, ничего не пишет в устройство — согласия не требует. */}
        <Analytics />
        
        {/* Structured data for local business */}
        <Script
          id="structured-data"
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              '@context': 'https://schema.org',
              '@type': 'Restaurant',
              name: 'Dumbos Pizza Bad Kissingen',
              image: `${siteUrl}/images/logo.png`,
              '@id': siteUrl,
              url: siteUrl,
              telephone: '+49 971 72730',
              address: {
                '@type': 'PostalAddress',
                streetAddress: 'Kurhausstraße 11A',
                addressLocality: 'Bad Kissingen',
                postalCode: '97688',
                addressCountry: 'DE'
              },
              geo: {
                '@type': 'GeoCoordinates',
                latitude: 50.19526,
                longitude: 10.07827
              },
              openingHoursSpecification: [
                {
                  '@type': 'OpeningHoursSpecification',
                  dayOfWeek: [
                    'Monday',
                    'Tuesday',
                    'Wednesday',
                    'Thursday',
                    'Friday',
                    'Saturday',
                    'Sunday'
                  ],
                  opens: orderHours.start,
                  closes: orderHours.end
                }
              ],
              servesCuisine: ['Pizza', 'Italienisch'],
              priceRange: '€€',
              paymentAccepted: 'Cash, Credit Card',
              deliveryArea: 'Bad Kissingen, Garitz, Hausen, Arnshausen, Reiterswiesen, Winkels'
            })
          }}
        />
        {/*
          <noscript>-пиксель Meta удалён намеренно: он срабатывал у всех без JS,
          а без JS невозможно ни спросить согласие, ни его учесть.
        */}
      </body>
    </html>
  )
}
