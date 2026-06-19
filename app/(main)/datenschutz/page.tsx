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

      <section>
        <h2 className="text-2xl font-semibold mb-3">5. Ihre Rechte: Auskunft, Löschung, Sperrung</h2>
        <p className="text-gray-700">
          Sie haben im Rahmen der geltenden gesetzlichen Bestimmungen jederzeit das Recht auf unentgeltliche Auskunft über Ihre
          gespeicherten personenbezogenen Daten, deren Herkunft und Empfänger und den Zweck der Datenverarbeitung und ggf. ein
          Recht auf Berichtigung, Sperrung oder Löschung dieser Daten.
        </p>
      </section>
    </div>
  )
}
