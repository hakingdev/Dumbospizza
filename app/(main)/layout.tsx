import { Header } from '../../components/header';
import { Footer } from '../../components/footer';
import CookieConsent from '../../components/CookieConsent';
import PromotionsModal from '../../components/promotions/PromotionsModal';
import PromotionOfferManager from '../../components/promotions/PromotionOfferManager';
import GiftThresholdReminder from '../../components/promotions/GiftThresholdReminder';

export default function MainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <Header />
      <main className="min-h-screen">
        {children}
      </main>
      <Footer />
      <CookieConsent />
      <PromotionsModal />
      <PromotionOfferManager />
      <GiftThresholdReminder />
    </>
  );
}

