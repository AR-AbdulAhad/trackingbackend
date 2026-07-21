# StudentLife Tracking API

## Setup

1. Copy `.env.example` to `.env` and fill in the values.
2. Run `npm install`
3. Run `npx prisma migrate dev` to create the database schema.
4. Run `npm run dev` to start the server.

## Scripts
- `npm run dev`: Starts the server in development mode using `tsx`.

## Creating an Admin User
To seed an initial admin user, you can run a script or insert directly into your database:
```sql
INSERT INTO `AdminUser` (`email`, `passwordHash`, `createdAt`) VALUES ('admin@studentlife.dk', 'HASHED_PASSWORD_HERE', NOW());
```
(You can generate a bcrypt hash using a simple node script or online tool).
