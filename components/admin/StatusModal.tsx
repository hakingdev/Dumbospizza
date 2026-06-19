"use client";

import React from 'react';

type StatusModalProps = {
  open: boolean;
  title?: string;
  message: string;
  onClose: () => void;
};

export default function StatusModal({ open, title, message, onClose }: StatusModalProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
        aria-hidden="true"
      />
      <div className="relative z-10 w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
        {title && <h2 className="text-lg font-semibold mb-2">{title}</h2>}
        <p className="text-sm text-gray-700 mb-6">{message}</p>
        <div className="flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="bg-primary-600 text-white px-4 py-2 rounded-md hover:bg-primary-700"
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
}

