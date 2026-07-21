# 🎓 StudyHub AI

An AI-powered collaborative learning platform that helps students study smarter by combining AI assistance, resource sharing, and collaborative study groups in one place.

---

## 📖 Overview

StudyHub AI is designed to solve common problems faced by students during their academic journey. Instead of switching between multiple applications for notes, discussions, file sharing, and AI tools, StudyHub AI brings everything together into a single platform.

Students can create study groups, share learning resources, upload notes and PDFs, and receive instant AI-powered assistance for their questions.

---

# ✨ Features

### 🤖 AI Study Assistant
- Ask academic questions and receive structured AI-generated answers.
- Generate concise summaries from study materials.
- Explain complex concepts in a simple and understandable way.
- Assist students with learning and revision.

### 👥 Study Groups
- Create public or private study groups.
- Join groups using invite codes.
- Collaborate with classmates.
- Manage group members.

### 📚 Resource Sharing
- Upload study notes and PDFs.
- Secure cloud storage for files.
- Easy access to shared resources.
- Organize learning materials in one place.

### 🔍 Smart Search
- Search study resources quickly.
- Find uploaded materials easily.

### 📱 Responsive Design
- Works on desktop, tablet, and mobile devices.

---

# 🎯 Problems It Solves

Students often face challenges such as:

- Notes scattered across multiple platforms.
- Difficulty collaborating with classmates.
- Waiting too long for answers to academic doubts.
- Managing study resources inefficiently.
- Finding reliable explanations for difficult topics.

StudyHub AI addresses these issues by providing a centralized learning platform where students can:

- Learn collaboratively.
- Share educational resources.
- Access AI-powered explanations instantly.
- Organize study materials efficiently.
- Improve productivity during exam preparation.

---

# 🛠 Tech Stack

## Frontend

- HTML5
- CSS3
- JavaScript

## Backend

- Node.js
- Express.js

## Database

- MongoDB

## Cloud Storage

- AWS S3

## Artificial Intelligence

- Google Gemini API

## Deployment

- Vercel

---

# 📂 Project Structure

```
StudyHub-AI/
│
├── client/
│   ├── css/
│   ├── js/
│   ├── images/
│   └── pages/
│
├── server/
│   ├── routes/
│   ├── controllers/
│   ├── middleware/
│   ├── models/
│   ├── config/
│   └── server.js
│
├── uploads/
├── package.json
├── .env.example
└── README.md
```

*(Modify the structure if your project differs.)*

---

# 🚀 Getting Started

## Prerequisites

- Node.js
- MongoDB
- AWS Account (S3 Bucket)
- Google Gemini API Key

---

## Installation

Clone the repository

```bash
git clone https://github.com/yourusername/StudyHub-AI.git
```

Go into the project directory

```bash
cd StudyHub-AI
```

Install dependencies

```bash
npm install
```

Create a `.env` file in the project root and configure the required environment variables.

Start the application

```bash
npm start
```

For development

```bash
npm run dev
```

---

# 🔑 Environment Variables

Create a `.env` file and configure:

```env
PORT=

MONGODB_URI=

JWT_SECRET=

AWS_ACCESS_KEY_ID=

AWS_SECRET_ACCESS_KEY=

AWS_REGION=

AWS_BUCKET_NAME=

GEMINI_API_KEY=

# Google OAuth (Web application client)
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
# Register this exact URL in Google Cloud Console for local development:
# http://localhost:4173/api/auth/google/callback
# In production, set the deployed callback URL explicitly:
# GOOGLE_REDIRECT_URI=https://your-domain.com/api/auth/google/callback
```

## Google sign-in setup

Create an OAuth 2.0 **Web application** client in Google Cloud Console and add the callback URL shown above to its authorized redirect URIs. Add the client ID and client secret to the deployment environment as well as your local `.env`. The client secret must remain server-side; the browser only navigates to the app's `/api/auth/google` endpoint.

---

# 📸 Screenshots

You can add screenshots here.

```
Home Page

Dashboard

Study Groups

AI Chat

Resource Library
```

---

# 🔮 Future Enhancements

- Notification System
- Assignment Submission
- AI-generated Flashcards
- AI Quiz Generator
- User Profiles
- Resource Recommendations
- Activity Dashboard
- Study Progress Tracking
- Dark Mode
- Real-time Group Chat
- Calendar & Deadlines
- Admin Dashboard

---

# 🤝 Contributing

Contributions are welcome!

1. Fork the repository.
2. Create a new feature branch.
3. Commit your changes.
4. Push the branch.
5. Open a Pull Request.

---

# ⭐ Support

If you found this project useful, consider giving it a ⭐ on GitHub.

Your support motivates further development.

---

# 📄 License

This project is licensed under the MIT License.

---

## 👨‍💻 Developer

**Suyash Mhetre**

If you like this project, feel free to connect, provide feedback, or contribute to making StudyHub AI even better.
