# Scribble - Collaborative Whiteboard Application

## Overview

Scribble is a real-time collaborative whiteboard application built as a full-stack TypeScript project. The application features a modern landing page showcasing collaborative drawing capabilities with integrated chat functionality. The project uses a monorepo structure with shared code between client and server, implementing a complete development and deployment workflow.

## System Architecture

### Frontend Architecture
- **Framework**: React 18 with TypeScript
- **Routing**: Wouter for lightweight client-side routing
- **State Management**: TanStack Query (React Query) for server state management
- **UI Framework**: Tailwind CSS with shadcn/ui component library
- **Animations**: Framer Motion for smooth animations and transitions
- **Build Tool**: Vite with custom configuration for development and production

### Backend Architecture
- **Runtime**: Node.js with Express.js framework
- **Language**: TypeScript with ES modules
- **Development**: TSX for TypeScript execution in development
- **Production**: ESBuild for server bundling

### Database Layer
- **ORM**: Drizzle ORM with PostgreSQL dialect
- **Schema**: Centralized schema definition in `shared/schema.ts`
- **Development Storage**: In-memory storage implementation for rapid prototyping
- **Production Ready**: Configured for Neon Database with connection pooling

## Key Components

### Shared Code Layer
- **Schema Definition**: User model with Zod validation schemas
- **Type Safety**: Shared TypeScript types between client and server
- **Validation**: Input validation using drizzle-zod integration

### Client Components
- **Landing Page**: Modern marketing site with multiple sections (hero, features, demo, pricing, testimonials)
- **UI Components**: Complete shadcn/ui component library implementation
- **Responsive Design**: Mobile-first approach with Tailwind CSS
- **Interactive Elements**: Animated backgrounds and smooth scrolling navigation

### Server Infrastructure
- **API Routes**: RESTful API structure with Express middleware
- **Storage Interface**: Abstracted storage layer supporting multiple backends
- **Development Tools**: Comprehensive logging and error handling
- **Static Serving**: Vite integration for serving React application

## Data Flow

1. **Client Requests**: React components make API calls using TanStack Query
2. **Server Processing**: Express routes handle requests using storage interface
3. **Data Storage**: Current implementation uses in-memory storage, ready for database integration
4. **Response Handling**: Type-safe responses with proper error handling
5. **State Management**: Client-side caching and synchronization via React Query

## External Dependencies

### Core Framework Dependencies
- **React Ecosystem**: React 18, React DOM, React Query
- **UI Components**: Radix UI primitives, Lucide React icons
- **Styling**: Tailwind CSS, class-variance-authority for component variants
- **Animation**: Framer Motion for interactive animations

### Development Tools
- **Build Tools**: Vite, ESBuild, TypeScript compiler
- **Database Tools**: Drizzle Kit for migrations and schema management
- **Development Servers**: TSX for TypeScript execution, Vite dev server

### Backend Infrastructure
- **Database**: Neon Database (PostgreSQL), Drizzle ORM
- **Session Management**: Connect-pg-simple for PostgreSQL session store
- **Utilities**: Date-fns for date manipulation, various utility libraries

## Deployment Strategy

### Development Environment
- **Local Development**: `npm run dev` starts both client and server with hot reload
- **Database**: In-memory storage for rapid prototyping
- **Port Configuration**: Server runs on port 5000 with proxy setup

### Production Deployment
- **Build Process**: 
  1. Vite builds React application to `dist/public`
  2. ESBuild bundles server code to `dist/index.js`
- **Environment**: Replit deployment with autoscale configuration
- **Database**: Production PostgreSQL via Neon Database
- **Static Assets**: Express serves built React application

### Replit Configuration
- **Modules**: Node.js 20, Web, PostgreSQL 16
- **Auto-deployment**: Configured for seamless deployment
- **Environment Variables**: DATABASE_URL for production database connection

## Changelog

```
Changelog:
- June 27, 2025. Initial setup
```

## User Preferences

```
Preferred communication style: Simple, everyday language.
```