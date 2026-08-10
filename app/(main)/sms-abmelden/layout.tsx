import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'SMS-Werbung abmelden | Dumbos Pizza Bad Kissingen',
  description: 'Abmeldung von Werbe-SMS (Angebote und Aktionen) von Dumbos Pizza.',
  robots: { index: false, follow: true },
};

export default function SmsAbmeldenLayout({ children }: { children: React.ReactNode }) {
  return children;
}
