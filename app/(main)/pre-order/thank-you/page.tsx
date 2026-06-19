"use client";

import { CheckCircle } from 'lucide-react';
import Link from 'next/link';

export default function PreOrderThankYouPage() {
  return (
    <div className="container mx-auto px-4 py-12">
      <div className="max-w-lg mx-auto bg-white rounded-lg shadow-lg p-8 text-center">
        <div className="text-green-500 mb-4">
          <CheckCircle className="w-20 h-20 mx-auto" />
        </div>
        <h1 className="text-3xl font-bold text-gray-900 mb-4">
          Vielen Dank für Ihre Anfrage!
        </h1>
        <p className="text-gray-600 mb-8 text-lg">
          Wir haben Ihre Daten erhalten und werden uns in Kürze bei Ihnen melden,
          um Ihre kostenlose Pizza an den Eröffnungstagen zu organisieren.
        </p>
        <Link
          href="/"
          className="inline-block px-8 py-3 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors"
        >
          Zur Startseite
        </Link>
      </div>
    </div>
  );
}
