"use client";

/**
 * Загрузка рекламных/аналитических тегов ПОСЛЕ согласия (TDDDG §25).
 *
 * Раньше все эти <Script> висели прямо в app/layout.tsx и выполнялись на каждом
 * заходе — _ga, _fbp и _ttp появлялись до того, как посетитель что-то нажал.
 *
 * Правила загрузки:
 *   • Meta и TikTok — только при marketing=true. У них нет cookieless-режима,
 *     поэтому единственный способ не поставить cookie — не грузить SDK.
 *   • Google — по GOOGLE_TAG_MODE (см. lib/consent.ts). В 'advanced' тег
 *     грузится сразу, но Consent Mode v2 в состоянии denied не даёт ему писать
 *     cookies; в 'basic' тег ждёт согласия.
 *
 * Значения по умолчанию для Consent Mode выставляет beforeInteractive-бутстрап
 * из app/layout.tsx — он обязан отработать раньше gtag.js.
 */

import Script from 'next/script';
import { useEffect, useState } from 'react';
import { GOOGLE_TAG_MODE, readConsent, subscribeConsent, type ConsentDecision } from '../lib/consent';

const GOOGLE_ADS_ID = 'AW-11384333898';
const META_PIXEL_ID = '900934192877252';
const TIKTOK_PIXEL_ID = 'D5UFMAJC77U2HKOKTTSG';

/** В .env.example лежит заглушка G-XXXXXXXX — с ней GA грузить бессмысленно. */
const rawGaId = process.env.NEXT_PUBLIC_GA_ID;
const GA_ID = rawGaId && !rawGaId.includes('XXXX') ? rawGaId : null;

export default function ConsentScripts() {
  const [decision, setDecision] = useState<ConsentDecision | null>(null);

  useEffect(() => {
    setDecision(readConsent());
    return subscribeConsent(setDecision);
  }, []);

  const analytics = decision?.analytics ?? false;
  const marketing = decision?.marketing ?? false;
  const loadGoogleTag = GOOGLE_TAG_MODE === 'advanced' || analytics || marketing;

  return (
    <>
      {loadGoogleTag && (
        <>
          <Script
            src={`https://www.googletagmanager.com/gtag/js?id=${GOOGLE_ADS_ID}`}
            strategy="afterInteractive"
          />
          <Script
            id="google-tag-config"
            strategy="afterInteractive"
            dangerouslySetInnerHTML={{
              __html: `
                gtag('config', '${GOOGLE_ADS_ID}');
                ${GA_ID ? `gtag('config', '${GA_ID}');` : ''}
              `,
            }}
          />
        </>
      )}

      {/*
        Здесь раньше на КАЖДОЙ загрузке страницы (включая 404) уходила конверсия
        покупки. В аккаунте это дало 2 000 фиктивных конверсий и коэффициент
        107,78% в Sales-Search-7 — больше конверсий, чем кликов.

        Теперь метка покупки отправляется ровно один раз, со страницы
        подтверждения заказа: app/(main)/checkout/confirmation/[orderId]/page.tsx
        через lib/analytics/google-ads.ts. Сюда её возвращать нельзя.
      */}

      {marketing && (
        <Script
          id="tiktok-pixel"
          strategy="afterInteractive"
          dangerouslySetInnerHTML={{
            __html: `
              !function (w, d, t) {
                w.TiktokAnalyticsObject=t;var ttq=w[t]=w[t]||[];ttq.methods=["page","track","identify","instances","debug","on","off","once","ready","alias","group","enableCookie","disableCookie","holdConsent","revokeConsent","grantConsent"],ttq.setAndDefer=function(t,e){t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}};for(var i=0;i<ttq.methods.length;i++)ttq.setAndDefer(ttq,ttq.methods[i]);ttq.instance=function(t){for(var e=ttq._i[t]||[],n=0;n<ttq.methods.length;n++)ttq.setAndDefer(e,ttq.methods[n]);return e},ttq.load=function(e,n){var r="https://analytics.tiktok.com/i18n/pixel/events.js",o=n&&n.partner;ttq._i=ttq._i||{},ttq._i[e]=[],ttq._i[e]._u=r,ttq._t=ttq._t||{},ttq._t[e]=+new Date,ttq._o=ttq._o||{},ttq._o[e]=n||{};n=document.createElement("script");n.type="text/javascript",n.async=!0,n.src=r+"?sdkid="+e+"&lib="+t;e=document.getElementsByTagName("script")[0];e.parentNode.insertBefore(n,e)};
                ttq.load('${TIKTOK_PIXEL_ID}');
                ttq.grantConsent();
                ttq.page();
              }(window, document, 'ttq');
            `,
          }}
        />
      )}

      {marketing && (
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
              fbq('consent', 'grant');
              fbq('init', '${META_PIXEL_ID}');
              fbq('track', 'PageView');
            `,
          }}
        />
      )}
    </>
  );
}
