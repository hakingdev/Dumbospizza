import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Datenschutzerklärung | Dumbos Pizza Bad Kissingen',
  description: 'Datenschutzerklärung von Dumbos Pizza Bad Kissingen.',
  robots: { index: false, follow: true },
};

export default function DatenschutzPage() {
  return (
    <div className="container mx-auto px-4 py-8 max-w-5xl">
      <h1 className="text-3xl font-bold mb-6">Datenschutzerklärung</h1>

      <section className="mb-8">
        <h2 className="text-2xl font-semibold mb-3">1. Datenschutz auf einen Blick</h2>
        <p className="text-gray-700 mb-4">
          Allgemeine Hinweise Die folgenden Hinweise geben einen einfachen Überblick darüber, was mit Ihren personenbezogenen
          Daten passiert, wenn Sie unsere Website besuchen. Personenbezogene Daten sind alle Daten, mit denen Sie persönlich
          identifiziert werden können.
        </p>
        <p className="text-gray-700">
          Datenerfassung auf unserer Website Die Datenverarbeitung auf dieser Website erfolgt durch den Websitebetreiber.
          Die Kontaktdaten können Sie dem Impressum dieser Website entnehmen.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-2xl font-semibold mb-3">2. Allgemeine Hinweise und Pflichtinformationen</h2>
        <p className="text-gray-700 mb-4">
          Datenschutz Die Betreiber dieser Seiten nehmen den Schutz Ihrer persönlichen Daten sehr ernst. Wir behandeln Ihre
          personenbezogenen Daten vertraulich und entsprechend der gesetzlichen Datenschutzvorschriften sowie dieser
          Datenschutzerklärung.
        </p>
        <p className="text-gray-700">
          Hinweis zur verantwortlichen Stelle Die verantwortliche Stelle für die Datenverarbeitung auf dieser Website ist:
          Dumbo Slice Pizza / Dumbos Pizza Mykhailo Barkhan Kurhausstr. 11A, 97688 Bad Kissingen E-Mail: info@dumbospizza.de
          Telefon: +4997172730
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-2xl font-semibold mb-3">3. Datenerfassung auf unserer Website</h2>
        <p className="text-gray-700 mb-4">
          Cookies Unsere Internetseiten verwenden teilweise so genannte Cookies. Cookies richten auf Ihrem Rechner keinen
          Schaden an und enthalten keine Viren. Cookies dienen dazu, unser Angebot nutzerfreundlicher, effektiver und sicherer
          zu machen.
        </p>
        <p className="text-gray-700 mb-4">
          Server-Log-Dateien Der Provider der Seiten erhebt und speichert automatisch Informationen in so genannten
          Server-Log-Dateien, die Ihr Browser automatisch an uns übermittelt. Dies sind:
        </p>
        <ul className="list-disc pl-6 text-gray-700 mb-4">
          <li>Browsertyp und Browserversion</li>
          <li>verwendetes Betriebssystem</li>
          <li>Referrer URL</li>
          <li>Hostname des zugreifenden Rechners</li>
          <li>Uhrzeit der Serveranfrage</li>
          <li>IP-Adresse</li>
        </ul>
        <p className="text-gray-700">
          Kontaktformular / Bestellung Wenn Sie uns per Kontaktformular Anfragen zukommen lassen oder eine Bestellung aufgeben,
          werden Ihre Angaben aus dem Anfrageformular inklusive der von Ihnen dort angegebenen Kontaktdaten (Name, Adresse,
          Telefonnummer) zwecks Bearbeitung der Anfrage und für den Fall von Anschlussfragen bei uns gespeichert. Diese Daten
          geben wir nicht ohne Ihre Einwilligung weiter. Die Verarbeitung dieser Daten erfolgt auf Grundlage von Art. 6 Abs. 1
          lit. b DSGVO, sofern Ihre Anfrage mit der Erfüllung eines Vertrags zusammenhängt (Bestellung einer Pizza).
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-2xl font-semibold mb-3">4. Analyse-Tools und Werbung (Google Maps)</h2>
        <p className="text-gray-700 mb-4">
          Diese Seite nutzt über eine API den Kartendienst Google Maps. Anbieter ist die Google Ireland Limited („Google“),
          Gordon House, Barrow Street, Dublin 4, Irland.
        </p>
        <p className="text-gray-700">
          Zur Nutzung der Funktionen von Google Maps ist es notwendig, Ihre IP Adresse zu speichern. Diese Informationen
          werden in der Regel an einen Server von Google in den USA übertragen und dort gespeichert. Der Anbieter dieser Seite
          hat keinen Einfluss auf diese Datenübertragung. Die Nutzung von Google Maps erfolgt im Interesse einer ansprechenden
          Darstellung unserer Online-Angebote und an einer leichten Auffindbarkeit der von uns auf der Website angegebenen Orte.
          Dies stellt ein berechtigtes Interesse im Sinne von Art. 6 Abs. 1 lit. f DSGVO dar.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-2xl font-semibold mb-3">5. E-Mail-Werbung an Bestandskunden</h2>
        <p className="text-gray-700 mb-4">
          Wenn Sie bei uns eine Bestellung aufgeben und dabei Ihre E-Mail-Adresse angeben, behalten
          wir uns vor, Ihnen per E-Mail Informationen und Angebote zu eigenen, ähnlichen Waren und
          Dienstleistungen (z. B. Pizza-Aktionen) zuzusenden. Rechtsgrundlage hierfür ist § 7 Abs. 3
          UWG in Verbindung mit unserem berechtigten Interesse an Direktwerbung gemäß Art. 6 Abs. 1
          lit. f DSGVO. Soweit Sie uns eine ausdrückliche Einwilligung erteilt haben, erfolgt der
          Versand auf Grundlage von Art. 6 Abs. 1 lit. a DSGVO.
        </p>
        <p className="text-gray-700 mb-4">
          Sie können dieser Verwendung Ihrer E-Mail-Adresse jederzeit widersprechen, ohne dass
          hierfür andere als die Übermittlungskosten nach den Basistarifen entstehen. Hierzu genügt
          der Abmelde-Link am Ende jeder Werbe-E-Mail oder eine Nachricht an info@dumbospizza.de.
          Nach Ihrem Widerspruch wird Ihre E-Mail-Adresse für Werbezwecke gesperrt und Sie erhalten
          keine weiteren Werbe-E-Mails mehr.
        </p>
        <p className="text-gray-700">
          Für den Versand unserer E-Mails nutzen wir den Dienstleister Brevo (Sendinblue GmbH,
          Köpenicker Straße 126, 10179 Berlin) als Auftragsverarbeiter gemäß Art. 28 DSGVO. Ihre
          Daten werden ausschließlich innerhalb der EU verarbeitet. Eine Speicherung erfolgt bis zu
          Ihrem Widerspruch.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-2xl font-semibold mb-3">6. SMS-Werbung</h2>
        <p className="text-gray-700 mb-4">
          Sofern Sie hierzu Ihre ausdrückliche Einwilligung erteilt haben (z. B. durch Setzen des
          entsprechenden Häkchens während der Bestellung), verwenden wir Ihre Telefonnummer, um Ihnen
          Angebote und Aktionen von Dumbos Pizza per SMS zuzusenden. Rechtsgrundlage ist Ihre
          Einwilligung gemäß Art. 6 Abs. 1 lit. a DSGVO sowie § 7 Abs. 2 UWG. Wir dokumentieren Ihre
          Einwilligung einschließlich Zeitpunkt und Einwilligungstext.
        </p>
        <p className="text-gray-700">
          Sie können Ihre Einwilligung jederzeit mit Wirkung für die Zukunft widerrufen, ohne dass
          hierfür andere als die Übermittlungskosten nach den Basistarifen entstehen. Den Widerruf
          richten Sie bitte an info@dumbospizza.de. Die Rechtmäßigkeit der bis zum Widerruf erfolgten
          Verarbeitung bleibt unberührt. Für den Versand nutzen wir den Dienstleister Brevo
          (Sendinblue GmbH) als Auftragsverarbeiter.
        </p>
      </section>

      <section>
        <h2 className="text-2xl font-semibold mb-3">7. Ihre Rechte: Auskunft, Löschung, Sperrung</h2>
        <p className="text-gray-700">
          Sie haben im Rahmen der geltenden gesetzlichen Bestimmungen jederzeit das Recht auf unentgeltliche Auskunft über Ihre
          gespeicherten personenbezogenen Daten, deren Herkunft und Empfänger und den Zweck der Datenverarbeitung und ggf. ein
          Recht auf Berichtigung, Sperrung oder Löschung dieser Daten.
        </p>
      </section>
    </div>
  )
}
