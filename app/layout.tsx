import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import { Header } from '../components/header'
import { Footer } from '../components/footer'
import Script from 'next/script'
import TranslationProvider from '../components/TranslationProvider'
import { GoogleAnalytics } from '@next/third-parties/google'
import { Analytics } from '@vercel/analytics/react'
import Providers from '../components/Providers'

const inter = Inter({ subsets: ['latin', 'cyrillic'] })
const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXTAUTH_URL || 'https://dumbospizza.de').replace(/\/$/, '')

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
    url: 'https://dumbospizza.de/',
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
    canonical: 'https://dumbospizza.de'
  }
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="de">
      <head>
        <link rel="alternate" hrefLang="de" href="https://dumbospizza.de" />
      </head>
      <body className={inter.className}>
        <Script
          src="https://www.googletagmanager.com/gtag/js?id=AW-11384333898"
          strategy="afterInteractive"
        />
        <Script
          id="google-ads-tag"
          strategy="afterInteractive"
          dangerouslySetInnerHTML={{
            __html: `
              window.dataLayer = window.dataLayer || [];
              function gtag(){dataLayer.push(arguments);}
              gtag('js', new Date());
              gtag('config', 'AW-11384333898');
              
              function gtag_report_conversion(url) {
                var callback = function () {
                  if (typeof(url) != 'undefined') {
                    window.location = url;
                  }
                };
                gtag('event', 'conversion', {
                    'send_to': 'AW-11384333898/wnsKCL2gwO8YEMrMvLQq',
                    'event_callback': callback
                });
                return false;
              }
            `
          }}
        />
        <Script
          id="google-ads-conversion"
          strategy="afterInteractive"
          dangerouslySetInnerHTML={{
            __html: `
              gtag('event', 'conversion', {'send_to': 'AW-11384333898/wnsKCL2gwO8YEMrMvLQq'});
            `
          }}
        />
        <Script
          id="tiktok-pixel"
          strategy="afterInteractive"
          dangerouslySetInnerHTML={{
            __html: `
              !function (w, d, t) {
                w.TiktokAnalyticsObject=t;var ttq=w[t]=w[t]||[];ttq.methods=["page","track","identify","instances","debug","on","off","once","ready","alias","group","enableCookie","disableCookie","holdConsent","revokeConsent","grantConsent"],ttq.setAndDefer=function(t,e){t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}};for(var i=0;i<ttq.methods.length;i++)ttq.setAndDefer(ttq,ttq.methods[i]);ttq.instance=function(t){for(var e=ttq._i[t]||[],n=0;n<ttq.methods.length;n++)ttq.setAndDefer(e,ttq.methods[n]);return e},ttq.load=function(e,n){var r="https://analytics.tiktok.com/i18n/pixel/events.js",o=n&&n.partner;ttq._i=ttq._i||{},ttq._i[e]=[],ttq._i[e]._u=r,ttq._t=ttq._t||{},ttq._t[e]=+new Date,ttq._o=ttq._o||{},ttq._o[e]=n||{};n=document.createElement("script");n.type="text/javascript",n.async=!0,n.src=r+"?sdkid="+e+"&lib="+t;e=document.getElementsByTagName("script")[0];e.parentNode.insertBefore(n,e)};
                ttq.load('D5UFMAJC77U2HKOKTTSG');
                ttq.page();
              }(window, document, 'ttq');
            `
          }}
        />
        <Script
          id="meta-pixel"
          strategy="afterInteractive"
          dangerouslySetInnerHTML={{
            __html: `
              !function(f,b,e,v,n,t,s)
              {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
              n.callMethod.apply(n,arguments):n.queue.push(arguments)};
              if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
              n.queue=[];t=b.createElement(e);t.async=!0;
              t.src=v;s=b.getElementsByTagName(e)[0];
              s.parentNode.insertBefore(t,s)}(window, document,'script',
              'https://connect.facebook.net/en_US/fbevents.js');
              fbq('init', '900934192877252');
              fbq('track', 'PageView');
            `
          }}
        />
        <Providers>
          <TranslationProvider>
            {children}
            <GoogleAnalytics gaId="G-XXXXXXXX" />
          </TranslationProvider>
        </Providers>
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
              image: 'https://dumbospizza.de/images/logo.png',
              '@id': 'https://dumbospizza.de',
              url: 'https://dumbospizza.de',
              telephone: '+49 971 99999',
              address: {
                '@type': 'PostalAddress',
                streetAddress: 'Kurhausstraße 11A',
                addressLocality: 'Bad Kissingen',
                postalCode: '97688',
                addressCountry: 'DE'
              },
              geo: {
                '@type': 'GeoCoordinates',
                latitude: 50.2006,
                longitude: 10.0767
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
                  opens: '11:00',
                  closes: '22:00'
                }
              ],
              servesCuisine: ['Pizza', 'Italienisch'],
              priceRange: '€€',
              paymentAccepted: 'Cash, Credit Card',
              deliveryArea: 'Bad Kissingen, Garitz, Hausen, Arnshausen, Reiterswiesen, Winkels'
            })
          }}
        />
        <noscript>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            height="1"
            width="1"
            style={{ display: 'none' }}
            src="https://www.facebook.com/tr?id=900934192877252&ev=PageView&noscript=1"
            alt=""
          />
        </noscript>
      </body>
    </html>
  )
}
