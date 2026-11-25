# StudentLife Tracking API

## Setup

1. Copy `.env.example` to `.env` and fill in the values.
2. Run `npm install`
3. Run `npx prisma migrate dev` to create the database schema.
4. Run `npm run dev` to start the server.

## Google Analytics 4

The dashboard reads Google Analytics data through the backend `/api/ga` endpoints.
Configure `GA4_PROPERTY_ID`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
`GOOGLE_REDIRECT_URI` (`http://localhost:3000/api/ga/callback` for local development),
and `FRONTEND_URL` in the backend environment. The redirect URI must also be registered
in the Google OAuth client.

The backend uses `ga-credentials.json` automatically for dashboard API requests, so no
interactive Google account connection is needed. Grant the service account's
`client_email` at least Viewer access in GA4 Admin → Property access management. The
`GA4_PROPERTY_ID` must match the property where that service account was granted access;
configuring credentials alone does not grant property access.

## Scripts
- `npm run dev`: Starts the server in development mode using `tsx`.

## Creating an Admin User
To seed an initial admin user, you can run a script or insert directly into your database:
```sql
INSERT INTO `AdminUser` (`email`, `passwordHash`, `createdAt`) VALUES ('admin@studentlife.dk', 'HASHED_PASSWORD_HERE', NOW());
```
(You can generate a bcrypt hash using a simple node script or online tool).
