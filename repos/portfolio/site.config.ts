import type { SiteConfig } from './types/site'

export const siteConfig: SiteConfig = {
  name: 'Kai Nguyen',
  tagline: 'Backend engineer building scalable game services and distributed systems.',
  resumeUrl: '/resume.pdf',
  socials: {
    linkedin: 'https://www.linkedin.com/in/zyot249/',
    email: 'mailto:dungnd249@gmail.com',
  },
  skills: [
    { category: 'Languages & Frameworks', items: ['C#', 'Java', 'ASP.NET Core', 'Spring Boot', 'Bitzero'] },
    { category: 'Databases & Caching', items: ['DynamoDB', 'PostgreSQL', 'MariaDB', 'MySQL', 'MongoDB', 'Redis', 'Memcached'] },
    { category: 'Distributed Systems', items: ['Microservices', 'gRPC', 'REST APIs', 'SignalR', 'Kafka', 'WebSocket', 'OpenMatch'] },
    { category: 'Observability & Quality', items: ['OpenTelemetry', 'New Relic', 'Load Testing', 'Unit Testing', 'Jest', 'Code Review'] },
    { category: 'Engineering Practices', items: ['Git', 'SVN', 'AWS', 'SOLID', 'Design Patterns', 'Agile', 'Scrum'] },
  ],
}
