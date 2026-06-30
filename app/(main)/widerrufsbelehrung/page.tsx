import type { Metadata } from 'next';
import { SELLER } from '../../../lib/company';

export const metadata: Metadata = {
  title: 'Widerrufsbelehrung | Dumbos Pizza Bad Kissingen',
  description: 'Widerrufsbelehrung und Muster-Widerrufsformular von Dumbos Pizza Bad Kissingen.',
  robots: { index: false, follow: true },
};

export default function WiderrufsbelehrungPage() {
  const anbieter = `${SELLER.legalName} (${SELLER.brand})`;
  const anschrift = `${SELLER.street}, ${SELLER.postalCode} ${SELLER.city}`;

  return (
    <div className="container mx-auto px-4 py-8 max-w-5xl">
      <h1 className="text-3xl font-bold mb-6">Widerrufsbelehrung</h1>

      <section className="mb-8">
        <h2 className="text-2xl font-semibold mb-3">Widerrufsrecht</h2>
        <p className="text-gray-700 mb-4">
          Sie haben das Recht, binnen vierzehn Tagen ohne Angabe von Gründen diesen Vertrag zu widerrufen.
        </p>
        <p className="text-gray-700 mb-4">
          Die Widerrufsfrist beträgt vierzehn Tage ab dem Tag, an dem Sie oder ein von Ihnen benannter Dritter,
          der nicht der Beförderer ist, die Waren in Besitz genommen haben bzw. hat.
        </p>
        <p className="text-gray-700 mb-4">
          Um Ihr Widerrufsrecht auszuüben, müssen Sie uns
        </p>
        <p className="text-gray-700 mb-4">
          {anbieter}
          <br />
          {anschrift}
          <br />
          Telefon: <span translate="no">{SELLER.phone}</span>
          <br />
          E-Mail: <span translate="no">{SELLER.email}</span>
        </p>
        <p className="text-gray-700 mb-4">
          mittels einer eindeutigen Erklärung (z.&nbsp;B. ein mit der Post versandter Brief, Telefax oder E-Mail)
          über Ihren Entschluss, diesen Vertrag zu widerrufen, informieren. Sie können dafür das beigefügte
          Muster-Widerrufsformular verwenden, das jedoch nicht vorgeschrieben ist.
        </p>
        <p className="text-gray-700">
          Zur Wahrung der Widerrufsfrist reicht es aus, dass Sie die Mitteilung über die Ausübung des
          Widerrufsrechts vor Ablauf der Widerrufsfrist absenden.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-2xl font-semibold mb-3">Folgen des Widerrufs</h2>
        <p className="text-gray-700 mb-4">
          Wenn Sie diesen Vertrag widerrufen, haben wir Ihnen alle Zahlungen, die wir von Ihnen erhalten haben,
          einschließlich der Lieferkosten (mit Ausnahme der zusätzlichen Kosten, die sich daraus ergeben, dass Sie
          eine andere Art der Lieferung als die von uns angebotene, günstigste Standardlieferung gewählt haben),
          unverzüglich und spätestens binnen vierzehn Tagen ab dem Tag zurückzuzahlen, an dem die Mitteilung über
          Ihren Widerruf dieses Vertrags bei uns eingegangen ist.
        </p>
        <p className="text-gray-700 mb-4">
          Für diese Rückzahlung verwenden wir dasselbe Zahlungsmittel, das Sie bei der ursprünglichen Transaktion
          eingesetzt haben, es sei denn, mit Ihnen wurde ausdrücklich etwas anderes vereinbart; in keinem Fall
          werden Ihnen wegen dieser Rückzahlung Entgelte berechnet.
        </p>
        <p className="text-gray-700 mb-4">
          Wir können die Rückzahlung verweigern, bis wir die Waren wieder zurückerhalten haben oder bis Sie den
          Nachweis erbracht haben, dass Sie die Waren zurückgesandt haben, je nachdem, welches der frühere
          Zeitpunkt ist.
        </p>
        <p className="text-gray-700 mb-4">
          Sie haben die Waren unverzüglich und in jedem Fall spätestens binnen vierzehn Tagen ab dem Tag, an dem Sie
          uns über den Widerruf dieses Vertrags unterrichten, an uns zurückzusenden oder zu übergeben. Die Frist ist
          gewahrt, wenn Sie die Waren vor Ablauf der Frist von vierzehn Tagen absenden. Sie tragen die unmittelbaren
          Kosten der Rücksendung der Waren.
        </p>
        <p className="text-gray-700">
          Sie müssen für einen etwaigen Wertverlust der Waren nur aufkommen, wenn dieser Wertverlust auf einen zur
          Prüfung der Beschaffenheit, Eigenschaften und Funktionsweise der Waren nicht notwendigen Umgang mit ihnen
          zurückzuführen ist.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-2xl font-semibold mb-3">Ausschluss bzw. vorzeitiges Erlöschen des Widerrufsrechts</h2>
        <p className="text-gray-700 mb-4">
          Das Widerrufsrecht besteht nach § 312g Abs. 2 BGB unter anderem nicht bei folgenden Verträgen:
        </p>
        <ul className="list-disc pl-6 text-gray-700 mb-4 space-y-2">
          <li>
            zur Lieferung von Waren, die nicht vorgefertigt sind und für deren Herstellung eine individuelle Auswahl
            oder Bestimmung durch den Verbraucher maßgeblich ist oder die eindeutig auf die persönlichen Bedürfnisse
            des Verbrauchers zugeschnitten sind (§ 312g Abs. 2 Nr. 1 BGB);
          </li>
          <li>
            zur Lieferung von Waren, die schnell verderben können oder deren Verfallsdatum schnell überschritten
            würde (§ 312g Abs. 2 Nr. 2 BGB);
          </li>
          <li>
            zur Lieferung versiegelter Waren, die aus Gründen des Gesundheitsschutzes oder der Hygiene nicht zur
            Rückgabe geeignet sind, wenn ihre Versiegelung nach der Lieferung entfernt wurde (§ 312g Abs. 2 Nr. 4 BGB).
          </li>
        </ul>
        <p className="text-gray-700">
          Da wir überwiegend frisch zubereitete und nach Ihren Wünschen zusammengestellte Speisen sowie schnell
          verderbliche Lebensmittel und Getränke liefern, besteht für diese Bestellungen kein Widerrufsrecht.
        </p>
      </section>

      <section>
        <h2 className="text-2xl font-semibold mb-3">Muster-Widerrufsformular</h2>
        <p className="text-gray-700 mb-4">
          (Wenn Sie den Vertrag widerrufen wollen, dann füllen Sie bitte dieses Formular aus und senden Sie es
          zurück.)
        </p>
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-5 text-gray-700 space-y-3">
          <p>
            An
            <br />
            {anbieter}
            <br />
            {anschrift}
            <br />
            E-Mail: <span translate="no">{SELLER.email}</span>
          </p>
          <p>
            Hiermit widerrufe(n) ich/wir (*) den von mir/uns (*) abgeschlossenen Vertrag über den Kauf der folgenden
            Waren (*)/die Erbringung der folgenden Dienstleistung (*):
          </p>
          <p>__________________________________________________</p>
          <p>Bestellt am (*)/erhalten am (*): [Datum]</p>
          <p>Name des/der Verbraucher(s): [Name]</p>
          <p>Anschrift des/der Verbraucher(s): [Anschrift]</p>
          <p>Unterschrift des/der Verbraucher(s) (nur bei Mitteilung auf Papier): __________________________</p>
          <p>Datum: [Datum]</p>
          <p className="text-sm text-gray-500">(*) Unzutreffendes streichen.</p>
        </div>
      </section>

      <p className="mt-8 text-sm text-gray-500">Stand: [TT.MM.JJJJ]</p>
    </div>
  );
}
