import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Impressum | Dumbos Pizza Bad Kissingen',
  description: 'Impressum und Anbieterkennzeichnung von Dumbos Pizza Bad Kissingen.',
  robots: { index: false, follow: true },
};

export default function ImpressumPage() {
  return (
    <div className="container mx-auto px-4 py-8 max-w-5xl">
      <h1 className="text-3xl font-bold mb-6">Impressum</h1>

      <section className="mb-8">
        <h2 className="text-2xl font-semibold mb-3">Angaben gemäß § 5 TMG</h2>
        <p className="text-gray-700">
          Weisses Haus GmbH<br />
          Kurhausstr. 11-A<br />
          97688 Bad Kissingen<br />
          Deutschland
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-2xl font-semibold mb-3">Vertreten durch</h2>
        <p className="text-gray-700">Mykhailo Barkhan (Geschäftsführer)</p>
      </section>

      <section className="mb-8">
        <h2 className="text-2xl font-semibold mb-3">Kontakt</h2>
        <p className="text-gray-700">
          Telefon: 0151 141/34 094<br />
          E-Mail: info@dumbospizza.de
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-2xl font-semibold mb-3">Registereintrag</h2>
        <p className="text-gray-700">
          Eintragung im Handelsregister.<br />
          Registergericht: Amtsgericht Schweinfurt<br />
          Registernummer: HRB 9292
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-2xl font-semibold mb-3">Umsatzsteuer-ID</h2>
        <p className="text-gray-700">
          Umsatzsteuer-Identifikationsnummer gemäß § 27 a Umsatzsteuergesetz: DE365866180
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-2xl font-semibold mb-3">Wirtschafts-Identifikationsnummer</h2>
        <p className="text-gray-700">Steuernummer: 205/142/20396</p>
      </section>

      <section className="mb-8">
        <h2 className="text-2xl font-semibold mb-3">Streitschlichtung</h2>
        <p className="text-gray-700">
          Hinweis zur EU-Plattform: Die Plattform der EU-Kommission zur Online-Streitbeilegung (OS-Plattform) wurde zum 20.
          Juli 2025 eingestellt. Informationen zum Verbraucherrecht finden Sie nun direkt auf den Seiten der Europäischen
          Kommission.
        </p>
        <p className="text-gray-700 mt-3">
          Verbraucherstreitbeilegung: Wir sind nicht bereit oder verpflichtet, an Streitbeilegungsverfahren vor einer
          Verbraucherschlichtungsstelle teilzunehmen.
        </p>
      </section>

    </div>
  )
}
