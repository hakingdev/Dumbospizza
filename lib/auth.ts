import { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { connectToDatabase } from "./models";
import { User } from "./models/user.model";
import bcrypt from "bcryptjs";

const nextAuthSecret =
  process.env.NEXTAUTH_SECRET ||
  (process.env.NODE_ENV === 'production' ? undefined : 'pizza-delivery-secret');

/**
 * Authentication configuration for Next.js
 */
export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "email", placeholder: "email@example.com" },
        password: { label: "Password", type: "password" }
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          return null;
        }
        
        await connectToDatabase();
        
        // Find user by email
        const user = await User.findOne({ email: credentials.email }).select('+password');
        
        if (!user || !user.password) {
          return null;
        }
        
        // Check password
        const isPasswordMatch = await bcrypt.compare(credentials.password, user.password);
        
        if (!isPasswordMatch) {
          return null;
        }
        
        // Only allow admin or staff users to log in
        if (user.role !== 'admin' && user.role !== 'staff') {
          return null;
        }
        
        return {
          id: user._id.toString(),
          name: user.name,
          email: user.email,
          role: user.role,
        };
      }
    })
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        const typedUser = user as { id?: string; role?: string };
        token.id = typedUser.id;
        token.role = typedUser.role;
      }
      return token;
    },
    async session({ session, token }) {
      if (token) {
        (session.user as { id?: string; role?: string }).id = token.id as string | undefined;
        (session.user as { id?: string; role?: string }).role = token.role as string | undefined;
      }
      return session;
    }
  },
  pages: {
    signIn: '/admin/login',
    error: '/admin/login',
  },
  session: {
    strategy: "jwt",
    maxAge: 30 * 24 * 60 * 60, // 30 days
  },
  secret: nextAuthSecret,
};

/**
 * Check if a user has admin privileges
 */
export function isAdmin(session: any) {
  return session?.user?.role === 'admin';
}

/**
 * Check if a user has staff privileges (admin or staff)
 */
export function isStaff(session: any) {
  return session?.user?.role === 'admin' || session?.user?.role === 'staff';
}
