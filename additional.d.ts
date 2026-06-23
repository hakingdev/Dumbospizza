// Global declarations

// Node Telegram Bot API extended types
declare module 'node-telegram-bot-api' {
    interface SendMessageOptions {
        parse_mode?: string;
        reply_markup?: any;
    }
}

// Extended OrderNotification interface for Telegram and printing
declare module '@/lib/telegram' {
    export interface OrderNotification {
        orderId: string;
        customerName: string;
        phoneNumber: string;
        address?: string;
        items: Array<{
            name: string;
            quantity: number;
            customizations?: string[];
        }>;
        totalAmount: number;
        paymentMethod: string;
        deliveryType: 'delivery' | 'pickup';
        notes?: string;
        deliveryFee?: number;
    }
}

// Node Thermal Printer extended types
declare module 'node-thermal-printer' {
    export enum PrinterTypes {
        EPSON = 'epson',
        STAR = 'star'
    }

    export enum BreakLine {
        WORD = 'word',
        CHARACTER = 'character'
    }

    export interface ThermalPrinterOptions {
        type: PrinterTypes;
        interface: string;
        options?: {
            timeout?: number;
        };
    }
}

// MongoDB mongoose global declarations
declare global {
    var mongoose: {
        conn: any | null;
        promise: Promise<any> | null;
    };
}

// Augment Next.js types
declare namespace JSX {
    interface IntrinsicElements {
        [elemName: string]: any;
    }
}

// Extend React namespace
declare namespace React {
    interface ReactNode {
        [key: string]: any;
    }
}
