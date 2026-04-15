// src/brain/framework-presets.ts — Framework-aware analysis presets

export type Framework =
  | 'nextjs' | 'react' | 'vue' | 'svelte' | 'angular'
  | 'express' | 'fastify' | 'nestjs' | 'hono'
  | 'django' | 'flask' | 'fastapi' | 'laravel'
  | 'spring' | 'go' | 'rust-axum'
  | 'unknown';

export interface FrameworkPreset {
  name: string;
  displayName: string;
  language: string[];
  rules: FrameworkRule[];
  securityChecks: string[];
  performanceChecks: string[];
  conventionChecks: string[];
  suggestedModels: string[];
  docsUrl: string;
}

export interface FrameworkRule {
  pattern: RegExp | ((files: string[], content: string) => boolean);
  message: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
  type: 'warning' | 'suggestion' | 'review';
  fix?: string;
}

export const FRAMEWORK_PRESETS: Record<Framework, FrameworkPreset> = {
  nextjs: {
    name: 'nextjs',
    displayName: 'Next.js',
    language: ['TypeScript', 'JavaScript'],
    rules: [
      {
        pattern: /getServerSideProps.*fetch.*http:\/\//,
        message: 'Using HTTP (not HTTPS) in server-side data fetching — this may expose data in transit.',
        priority: 'high', type: 'warning',
        fix: 'Replace http:// with https:// for all external fetch calls',
      },
      {
        pattern: /pages\/api\/.*\.ts/,
        message: 'API route changed — verify authentication middleware is applied and rate limiting is configured.',
        priority: 'medium', type: 'review',
      },
      {
        pattern: /next\.config/,
        message: 'next.config changed — review: headers, rewrites, image domains, experimental flags.',
        priority: 'high', type: 'review',
      },
      {
        pattern: /useEffect.*fetch/,
        message: 'Data fetching in useEffect — consider React Query, SWR, or Next.js Server Components for better caching.',
        priority: 'low', type: 'suggestion',
        fix: 'Use useSWR() or React Query for automatic caching, deduplication, and error handling.',
      },
      {
        pattern: (files) => files.some(f => f.startsWith('pages/') && f.endsWith('.tsx')),
        message: 'Pages Router detected — consider migrating to App Router (Next.js 13+) for better performance and layouts.',
        priority: 'low', type: 'suggestion',
      },
    ],
    securityChecks: ['CORS headers in API routes', 'next-auth configuration', 'CSP headers', 'env var exposure in client bundles'],
    performanceChecks: ['Image optimization (next/image)', 'Font optimization (next/font)', 'Bundle size with @next/bundle-analyzer', 'ISR/SSG vs SSR choice'],
    conventionChecks: ['app/ vs pages/ consistency', 'layout.tsx hierarchy', 'loading.tsx/error.tsx files', 'API route naming'],
    suggestedModels: ['llama3', 'codellama', 'deepseek-coder'],
    docsUrl: 'https://nextjs.org/docs',
  },

  react: {
    name: 'react',
    displayName: 'React',
    language: ['TypeScript', 'JavaScript'],
    rules: [
      {
        pattern: /useEffect\s*\(\s*async/,
        message: 'async directly in useEffect — this creates an unhandled promise. Use an inner async function.',
        priority: 'high', type: 'warning',
        fix: 'useEffect(() => { const load = async () => { ... }; load(); }, [deps])',
      },
      {
        pattern: /useState.*\[\s*\]/,
        message: 'Array state initialized as [] — consider using proper TypeScript typing: useState<Item[]>([])',
        priority: 'low', type: 'suggestion',
      },
      {
        pattern: /key=\{index\}|key=\{i\}/,
        message: 'Using array index as React key — causes issues with reordering. Use stable unique IDs.',
        priority: 'medium', type: 'warning',
        fix: 'Use item.id or a unique property as key, not the array index.',
      },
      {
        pattern: /dangerouslySetInnerHTML/,
        message: 'dangerouslySetInnerHTML detected — ensure content is sanitized with DOMPurify to prevent XSS.',
        priority: 'critical', type: 'warning',
        fix: 'import DOMPurify from "dompurify"; ... __html: DOMPurify.sanitize(content)',
      },
      {
        pattern: /import React from/,
        message: 'Old React import style — React 17+ with JSX transform doesn\'t require importing React.',
        priority: 'low', type: 'suggestion',
        fix: 'Remove "import React from \'react\'" — not needed with modern JSX transform.',
      },
    ],
    securityChecks: ['XSS via dangerouslySetInnerHTML', 'eval in components', 'exposed sensitive data in Redux state'],
    performanceChecks: ['React.memo usage', 'useMemo/useCallback', 'lazy loading (React.lazy)', 'avoiding inline function props'],
    conventionChecks: ['Component naming (PascalCase)', 'Hook naming (useXxx)', 'prop-types or TypeScript types'],
    suggestedModels: ['llama3', 'mistral'],
    docsUrl: 'https://react.dev',
  },

  express: {
    name: 'express',
    displayName: 'Express.js',
    language: ['TypeScript', 'JavaScript'],
    rules: [
      {
        pattern: /app\.use\s*\(\s*express\.json\s*\(\s*\)\s*\)/,
        message: 'express.json() without size limit — add a limit to prevent DoS: express.json({ limit: "10mb" })',
        priority: 'medium', type: 'suggestion',
      },
      {
        pattern: /res\.json\s*\(err\)|res\.send\s*\(err\)/,
        message: 'Sending raw error object to client — may expose stack traces. Send sanitized error responses.',
        priority: 'high', type: 'warning',
        fix: 'res.status(500).json({ error: "Internal server error" }) // never expose err.stack in production',
      },
      {
        pattern: /app\.use\s*\([^)]*cors/,
        message: 'CORS middleware detected — verify allowed origins are restricted in production.',
        priority: 'medium', type: 'review',
      },
      {
        pattern: (files) => !files.some(f => /helmet/.test(f)) && files.some(f => /app\.ts|server\.ts|index\.ts/.test(f)),
        message: 'No helmet.js detected — add it for essential security headers (CSP, HSTS, etc.)',
        priority: 'high', type: 'suggestion',
        fix: 'npm i helmet && app.use(helmet())',
      },
      {
        pattern: /router\.get|router\.post|router\.put|router\.delete/,
        message: 'Route handler changed — verify: input validation (zod/joi), authentication middleware, rate limiting.',
        priority: 'medium', type: 'review',
      },
    ],
    securityChecks: ['helmet.js', 'rate-limiting (express-rate-limit)', 'input validation', 'SQL injection in queries', 'JWT verification'],
    performanceChecks: ['compression middleware', 'caching headers', 'async/await vs callbacks', 'connection pooling'],
    conventionChecks: ['router separation', 'middleware order', 'error handler placement (last)', 'async error catching'],
    suggestedModels: ['llama3', 'deepseek-coder'],
    docsUrl: 'https://expressjs.com',
  },

  fastapi: {
    name: 'fastapi',
    displayName: 'FastAPI',
    language: ['Python'],
    rules: [
      {
        pattern: /def\s+\w+\s*\(.*\)\s*:/,
        message: 'Sync endpoint detected in FastAPI — use async def for I/O-bound operations for better concurrency.',
        priority: 'medium', type: 'suggestion',
        fix: 'Change "def endpoint()" to "async def endpoint()" for I/O operations.',
      },
      {
        pattern: /print\s*\(/,
        message: 'print() in FastAPI handler — use Python logging module instead.',
        priority: 'low', type: 'suggestion',
        fix: 'import logging; logger = logging.getLogger(__name__); logger.info("...")',
      },
      {
        pattern: /Depends\s*\(\s*\)/,
        message: 'FastAPI dependency with no function — verify dependency injection is set up correctly.',
        priority: 'medium', type: 'review',
      },
      {
        pattern: /\.env/,
        message: 'Env file reference — use pydantic-settings (BaseSettings) for typed env var management.',
        priority: 'low', type: 'suggestion',
        fix: 'from pydantic_settings import BaseSettings; class Settings(BaseSettings): API_KEY: str',
      },
    ],
    securityChecks: ['OAuth2 / JWT with python-jose', 'CORS origins restriction', 'input validation via Pydantic', 'SQL injection in raw queries'],
    performanceChecks: ['async def vs def', 'background tasks', 'response caching', 'database connection pooling (SQLAlchemy async)'],
    conventionChecks: ['Pydantic models for request/response', 'APIRouter for route grouping', 'dependency injection patterns'],
    suggestedModels: ['llama3', 'codellama'],
    docsUrl: 'https://fastapi.tiangolo.com',
  },

  django: {
    name: 'django',
    displayName: 'Django',
    language: ['Python'],
    rules: [
      {
        pattern: /DEBUG\s*=\s*True/,
        message: 'DEBUG=True detected — never run with DEBUG=True in production. Exposes stack traces and disables security.',
        priority: 'critical', type: 'warning',
        fix: 'Set DEBUG = config("DEBUG", default=False, cast=bool) using python-decouple',
      },
      {
        pattern: /ALLOWED_HOSTS\s*=\s*\[['"]?\*['"]?\]/,
        message: 'ALLOWED_HOSTS = ["*"] — too permissive. Specify exact hostnames for production.',
        priority: 'critical', type: 'warning',
      },
      {
        pattern: /SECRET_KEY\s*=\s*['"][^'"]{5,}/,
        message: 'Hardcoded Django SECRET_KEY — move to environment variable immediately.',
        priority: 'critical', type: 'warning',
        fix: 'SECRET_KEY = os.environ["DJANGO_SECRET_KEY"]',
      },
      {
        pattern: /objects\.filter.*format\(|objects\.filter.*%s/,
        message: 'Possible raw SQL string formatting in Django ORM — use F() expressions or parameterized queries.',
        priority: 'high', type: 'warning',
      },
      {
        pattern: /migrations\//,
        message: 'Django migration changed — review for: data migrations, irreversible operations, index creation on large tables.',
        priority: 'high', type: 'review',
      },
    ],
    securityChecks: ['CSRF protection', 'SECRET_KEY in env', 'DEBUG=False in production', 'ALLOWED_HOSTS', 'XSS via mark_safe'],
    performanceChecks: ['select_related/prefetch_related for N+1', 'database indexes', 'caching with django-cache', 'celery for async tasks'],
    conventionChecks: ['model __str__ methods', 'view function vs class-based', 'serializer validation', 'URL naming'],
    suggestedModels: ['llama3', 'codellama'],
    docsUrl: 'https://docs.djangoproject.com',
  },

  nestjs: {
    name: 'nestjs',
    displayName: 'NestJS',
    language: ['TypeScript'],
    rules: [
      {
        pattern: /@Get|@Post|@Put|@Delete/,
        message: 'Controller endpoint changed — verify: Guards (@UseGuards), pipes (@UsePipes), interceptors, and Swagger decorators.',
        priority: 'medium', type: 'review',
      },
      {
        pattern: /ConfigService.*process\.env/,
        message: 'Direct process.env access instead of ConfigService — use @nestjs/config for typed env management.',
        priority: 'low', type: 'suggestion',
      },
      {
        pattern: /@Injectable\(\)/,
        message: 'Injectable service changed — check for circular dependencies and proper module imports.',
        priority: 'low', type: 'review',
      },
      {
        pattern: /prisma\.|TypeORM|mongoose/i,
        message: 'ORM usage detected — ensure transactions are used for multi-step operations and N+1 is avoided.',
        priority: 'medium', type: 'suggestion',
      },
    ],
    securityChecks: ['AuthGuard usage', 'CORS configuration', 'helmet integration', 'rate limiting (ThrottlerModule)', 'class-validator pipes'],
    performanceChecks: ['caching with CacheModule', 'async providers', 'lazy modules', 'database N+1 prevention'],
    conventionChecks: ['module organization', 'DTO classes with validation', 'exception filters', 'interceptors for logging'],
    suggestedModels: ['llama3', 'deepseek-coder'],
    docsUrl: 'https://docs.nestjs.com',
  },

  vue: {
    name: 'vue',
    displayName: 'Vue.js',
    language: ['TypeScript', 'JavaScript'],
    rules: [
      {
        pattern: /v-html/,
        message: 'v-html directive used — renders raw HTML, which is vulnerable to XSS. Sanitize with DOMPurify.',
        priority: 'critical', type: 'warning',
        fix: 'Use v-text for plain text or sanitize: v-html="DOMPurify.sanitize(content)"',
      },
      {
        pattern: /v-for.*:key="index"/,
        message: 'Using array index as v-for key — causes rendering issues with reordering. Use unique IDs.',
        priority: 'medium', type: 'warning',
      },
    ],
    securityChecks: ['v-html XSS', 'CSP configuration', 'Pinia store exposure'],
    performanceChecks: ['v-once for static content', 'v-memo', 'async components (defineAsyncComponent)', 'Pinia vs Vuex'],
    conventionChecks: ['Composition API vs Options API consistency', 'script setup syntax', 'component naming'],
    suggestedModels: ['llama3', 'mistral'],
    docsUrl: 'https://vuejs.org',
  },

  svelte: {
    name: 'svelte',
    displayName: 'Svelte / SvelteKit',
    language: ['TypeScript', 'JavaScript'],
    rules: [
      {
        pattern: /@html/,
        message: '{@html ...} directive — renders raw HTML. Sanitize with DOMPurify to prevent XSS.',
        priority: 'critical', type: 'warning',
      },
      {
        pattern: /\+server\.ts|\+page\.server\.ts/,
        message: 'SvelteKit server endpoint changed — verify: authentication, input validation, rate limiting.',
        priority: 'medium', type: 'review',
      },
    ],
    securityChecks: ['@html XSS', 'server load function auth', 'form action validation'],
    performanceChecks: ['reactive statement efficiency', 'lazy loading with import()', 'SSR vs CSR choice'],
    conventionChecks: ['file-based routing conventions', 'load function patterns', 'stores usage'],
    suggestedModels: ['llama3'],
    docsUrl: 'https://svelte.dev',
  },

  angular: {
    name: 'angular',
    displayName: 'Angular',
    language: ['TypeScript'],
    rules: [
      {
        pattern: /bypassSecurityTrust/,
        message: 'bypassSecurityTrust* used — this bypasses Angular\'s built-in XSS protection. Sanitize content first.',
        priority: 'critical', type: 'warning',
      },
      {
        pattern: /ChangeDetectionStrategy\.Default/,
        message: 'Default change detection — consider OnPush strategy for better performance.',
        priority: 'low', type: 'suggestion',
        fix: 'changeDetection: ChangeDetectionStrategy.OnPush',
      },
    ],
    securityChecks: ['bypassSecurityTrust', 'CSRF tokens', 'HttpClient interceptors'],
    performanceChecks: ['OnPush change detection', 'trackBy in ngFor', 'lazy loading modules'],
    conventionChecks: ['component structure', 'service injection', 'module imports'],
    suggestedModels: ['llama3', 'deepseek-coder'],
    docsUrl: 'https://angular.dev',
  },

  flask: {
    name: 'flask',
    displayName: 'Flask',
    language: ['Python'],
    rules: [
      {
        pattern: /app\.run\s*\(.*debug\s*=\s*True/,
        message: 'Flask running with debug=True — this enables the Werkzeug debugger which is a major security risk in production.',
        priority: 'critical', type: 'warning',
        fix: 'Set debug=False in production. Use FLASK_ENV=production env var.',
      },
      {
        pattern: /SECRET_KEY\s*=\s*['"][^'"]+['"]/,
        message: 'Hardcoded Flask SECRET_KEY — move to environment variable.',
        priority: 'critical', type: 'warning',
      },
    ],
    securityChecks: ['debug mode', 'SECRET_KEY in env', 'CORS with flask-cors', 'SQL injection in raw queries'],
    performanceChecks: ['async routes (Flask 2.0+)', 'caching with flask-caching', 'gunicorn workers'],
    conventionChecks: ['blueprints for route grouping', 'application factory pattern', 'config objects'],
    suggestedModels: ['llama3', 'codellama'],
    docsUrl: 'https://flask.palletsprojects.com',
  },

  laravel: {
    name: 'laravel',
    displayName: 'Laravel',
    language: ['PHP'],
    rules: [
      {
        pattern: /DB::statement.*\$/,
        message: 'Raw DB statement with variable — use query builder bindings to prevent SQL injection.',
        priority: 'critical', type: 'warning',
        fix: 'DB::statement("... WHERE id = ?", [$id])',
      },
      {
        pattern: /APP_DEBUG=true/i,
        message: 'APP_DEBUG=true in .env — must be false in production.',
        priority: 'critical', type: 'warning',
      },
    ],
    securityChecks: ['CSRF tokens', 'SQL injection', 'mass assignment ($fillable)', 'APP_DEBUG=false', 'validation rules'],
    performanceChecks: ['eager loading (with())', 'query caching', 'queue jobs for heavy operations', 'N+1 detection'],
    conventionChecks: ['resource controllers', 'form requests', 'policies', 'repository pattern'],
    suggestedModels: ['llama3', 'codellama'],
    docsUrl: 'https://laravel.com/docs',
  },

  spring: {
    name: 'spring',
    displayName: 'Spring Boot',
    language: ['Java'],
    rules: [
      {
        pattern: /@RequestMapping|@GetMapping|@PostMapping/,
        message: 'REST endpoint changed — verify: @Valid annotation, security config, OpenAPI documentation.',
        priority: 'medium', type: 'review',
      },
      {
        pattern: /createQuery.*\+|nativeQuery.*true/,
        message: 'Raw or concatenated query in Spring — use JPQL named parameters or Spring Data to prevent injection.',
        priority: 'high', type: 'warning',
      },
    ],
    securityChecks: ['Spring Security config', 'CORS configuration', 'JWT filter', '@Valid on inputs', 'actuator endpoints'],
    performanceChecks: ['lazy loading (@Fetch)', 'N+1 with EntityGraph', '@Cacheable', 'connection pool (HikariCP)'],
    conventionChecks: ['layered architecture (Controller/Service/Repository)', '@Transactional usage', 'DTOs vs entities in controllers'],
    suggestedModels: ['llama3', 'codellama'],
    docsUrl: 'https://docs.spring.io/spring-boot',
  },

  go: {
    name: 'go',
    displayName: 'Go',
    language: ['Go'],
    rules: [
      {
        pattern: /fmt\.Sprintf.*sql|db\.Query.*fmt\./,
        message: 'String formatting in SQL query — use parameterized queries with db.Query("... $1", val).',
        priority: 'critical', type: 'warning',
      },
      {
        pattern: /err\s*!=\s*nil\s*\{[\s\n]*\}/,
        message: 'Empty error handler — never silently ignore errors in Go. At minimum log them.',
        priority: 'high', type: 'warning',
        fix: 'if err != nil { log.Printf("operation failed: %v", err); return err }',
      },
      {
        pattern: /go\s+func\s*\(/,
        message: 'Goroutine spawned — ensure proper synchronization (WaitGroup/channel) and handle panics.',
        priority: 'medium', type: 'review',
      },
    ],
    securityChecks: ['SQL injection', 'context timeout/deadline', 'TLS certificate verification', 'input validation'],
    performanceChecks: ['goroutine pool vs unbounded spawning', 'sync.Pool for allocations', 'pprof profiling', 'defer in loops'],
    conventionChecks: ['error wrapping (fmt.Errorf("%w", err))', 'interface naming', 'package structure', 'context propagation'],
    suggestedModels: ['llama3', 'deepseek-coder'],
    docsUrl: 'https://go.dev/doc',
  },

  'rust-axum': {
    name: 'rust-axum',
    displayName: 'Rust (Axum)',
    language: ['Rust'],
    rules: [
      {
        pattern: /unwrap\(\)|expect\("/,
        message: 'unwrap()/expect() in production code — panics the thread on None/Err. Use ? operator or handle errors.',
        priority: 'high', type: 'warning',
        fix: 'Use the ? operator or match/if let for proper error handling.',
      },
      {
        pattern: /unsafe\s*\{/,
        message: 'unsafe block detected — document WHY it\'s safe, minimize scope, and add tests.',
        priority: 'high', type: 'review',
      },
    ],
    securityChecks: ['unsafe blocks', 'integer overflow in release mode', 'deserialization of untrusted input'],
    performanceChecks: ['clone() frequency', 'Arc vs Rc', 'async trait overhead', 'tokio task spawning'],
    conventionChecks: ['Result/Option propagation', 'error types (thiserror)', 'module visibility', 'clippy lints'],
    suggestedModels: ['llama3', 'deepseek-coder'],
    docsUrl: 'https://docs.rs/axum',
  },

  fastify: {
    name: 'fastify',
    displayName: 'Fastify',
    language: ['TypeScript', 'JavaScript'],
    rules: [
      {
        pattern: /reply\.send\(err\)|reply\.send\(error\)/,
        message: 'Sending raw error to client — may expose stack traces. Use a sanitized error response.',
        priority: 'high', type: 'warning',
        fix: 'reply.status(500).send({ error: "Internal server error" })',
      },
      {
        pattern: /fastify\.register/,
        message: 'Plugin registered — verify encapsulation scope and that hooks/decorators are correctly scoped.',
        priority: 'low', type: 'review',
      },
      {
        pattern: /schema:\s*\{/,
        message: 'Route schema detected — ensure JSON Schema validation covers all input fields (body, params, querystring).',
        priority: 'medium', type: 'suggestion',
      },
    ],
    securityChecks: ['@fastify/helmet', '@fastify/cors origins', '@fastify/rate-limit', 'schema validation on all routes', 'JWT verification'],
    performanceChecks: ['serialization schemas (faster-json-stringify)', 'async route handlers', 'connection pooling', 'caching with @fastify/caching'],
    conventionChecks: ['plugin encapsulation', 'decorators usage', 'lifecycle hooks order', 'schema-first development'],
    suggestedModels: ['llama3', 'deepseek-coder'],
    docsUrl: 'https://fastify.dev',
  },

  hono: {
    name: 'hono',
    displayName: 'Hono',
    language: ['TypeScript'],
    rules: [
      {
        pattern: /c\.req\.raw/,
        message: 'Accessing raw request — validate and sanitize all input before use.',
        priority: 'medium', type: 'review',
      },
    ],
    securityChecks: ['CORS middleware', 'bearer auth', 'csrf middleware', 'rate limiting'],
    performanceChecks: ['edge runtime compatibility', 'streaming responses', 'caching headers'],
    conventionChecks: ['middleware ordering', 'type-safe RPC (hc)', 'zod-openapi'],
    suggestedModels: ['llama3'],
    docsUrl: 'https://hono.dev',
  },

  unknown: {
    name: 'unknown',
    displayName: 'Generic Project',
    language: [],
    rules: [],
    securityChecks: ['hardcoded secrets', 'SQL injection', 'XSS', 'eval usage'],
    performanceChecks: ['async vs sync I/O', 'N+1 patterns', 'memory leaks'],
    conventionChecks: ['naming consistency', 'error handling', 'logging'],
    suggestedModels: ['llama3', 'mistral'],
    docsUrl: '',
  },
};

/**
 * Auto-detect the framework from project context
 */
export function detectFramework(
  files: string[],
  pkgDeps?: Record<string, string>,
  language?: string[],
): Framework {
  const fileStr = files.join('\n').toLowerCase();
  const deps = Object.keys(pkgDeps || {}).join(' ').toLowerCase();
  const allDeps = deps;

  // Next.js
  if (allDeps.includes('next') && (allDeps.includes('react') || fileStr.includes('next.config'))) return 'nextjs';
  // React (standalone)
  if (allDeps.includes('react') && !allDeps.includes('next') && !allDeps.includes('@angular')) return 'react';
  // Vue
  if (allDeps.includes('vue') || fileStr.includes('.vue')) return 'vue';
  // Svelte
  if (allDeps.includes('svelte') || fileStr.includes('.svelte')) return 'svelte';
  // Angular
  if (allDeps.includes('@angular/core')) return 'angular';
  // NestJS
  if (allDeps.includes('@nestjs/core')) return 'nestjs';
  // Express
  if (allDeps.includes('express') && !allDeps.includes('@nestjs')) return 'express';
  // Hono
  if (allDeps.includes('hono')) return 'hono';
  // Fastify
  if (allDeps.includes('fastify')) return 'fastify';
  // Django (Python)
  if (fileStr.includes('manage.py') || fileStr.includes('django')) return 'django';
  // FastAPI
  if (fileStr.includes('fastapi') || deps.includes('fastapi')) return 'fastapi';
  // Flask
  if (deps.includes('flask') || fileStr.includes('flask')) return 'flask';
  // Laravel (PHP)
  if (fileStr.includes('artisan') || fileStr.includes('laravel')) return 'laravel';
  // Spring Boot
  if (fileStr.includes('pom.xml') || fileStr.includes('build.gradle') || deps.includes('spring')) return 'spring';
  // Go
  if (fileStr.includes('go.mod') || (language || []).includes('Go')) return 'go';
  // Rust
  if (fileStr.includes('cargo.toml') || (language || []).includes('Rust')) return 'rust-axum';

  return 'unknown';
}

/**
 * Apply framework-specific rules to file changes
 */
export function applyFrameworkRules(
  framework: Framework,
  files: string[],
  content: string,
): Array<{ message: string; priority: string; type: string; fix?: string }> {
  const preset = FRAMEWORK_PRESETS[framework];
  if (!preset) return [];

  const results: Array<{ message: string; priority: string; type: string; fix?: string }> = [];

  for (const rule of preset.rules) {
    let matched = false;
    if (rule.pattern instanceof RegExp) {
      matched = rule.pattern.test(content);
    } else if (typeof rule.pattern === 'function') {
      matched = rule.pattern(files, content);
    }

    if (matched) {
      results.push({
        message: rule.message,
        priority: rule.priority,
        type: rule.type,
        fix: rule.fix,
      });
    }
  }

  return results;
}
