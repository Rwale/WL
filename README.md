# ReportFlow — GitHub and Vercel edition

This folder contains the portable Vercel version of ReportFlow. It includes:

- team registration and secure sign-in;
- administrator, manager, supervisor and field-executive roles;
- activations, outlets and weekly report submission;
- Excel workbook upload and automatic `WEEK`-sheet import;
- dashboard, filters, review workflow and Excel export;
- Neon/Postgres database storage;
- Vercel Blob storage for Excel files and report evidence.

## 1. Push this folder to GitHub

Create an empty repository on GitHub, then run these commands inside this folder:

```bash
git init
git add .
git commit -m "Initial ReportFlow Vercel app"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/YOUR-REPOSITORY.git
git push -u origin main
```

Do not commit a real `.env` file. Only `.env.example` should be in GitHub.

## 2. Create the required Vercel services

In Vercel:

1. Import the GitHub repository as a new project.
2. Open **Storage / Marketplace** and add a **Neon Postgres** database. Make sure it supplies `DATABASE_URL` to the project.
3. Add a **Vercel Blob** store. Vercel will supply `BLOB_READ_WRITE_TOKEN`.
4. Add these additional environment variables for Production, Preview and Development:

| Variable | What to enter |
|---|---|
| `AUTH_SECRET` | A private random string of at least 32 characters |
| `TEAM_SIGNUP_CODE` | A private code you will share only with your five team members |

The complete variable list is also in `.env.example`.

## 3. Deploy

Click **Deploy** in Vercel. The build runs the database migration before building the Next.js application.

After deployment:

1. Open the Vercel URL.
2. Select **Create account**.
3. Register yourself first—you become the Administrator.
4. Give the Vercel URL and `TEAM_SIGNUP_CODE` to your team.
5. Team members create their accounts and initially receive the Field Executive role.
6. Use **Team** in ReportFlow to change roles if required.
7. Re-upload the William Lawson workbook under **Templates → Upload / Import Excel** to populate the new deployment.

## Local development

Copy `.env.example` to `.env.local`, enter valid credentials, then run:

```bash
npm install
npm run db:migrate
npm run dev
```

## Important data note

This repository contains application code only. The records and uploaded files in the existing ChatGPT Sites deployment are not copied into GitHub. Re-upload the Excel workbook in the new Vercel deployment, or perform a separate data migration if historical review comments and evidence files must also move.
