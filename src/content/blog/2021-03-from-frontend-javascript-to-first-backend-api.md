---
title: "From frontend JavaScript to my first backend API"
slug: "from-frontend-javascript-to-first-backend-api"
date: 2021-03-20
category: "Backend"
tags: ["Node.js", "Express", "JavaScript", "JWT", "Backend"]
readingTime: "7 min read"
excerpt: "I'd been writing frontend JavaScript for a while, but had no idea what happened on the other side of my API calls. Here's how I went from fetch() to actually building the server."
---

I'd been writing JavaScript for the frontend for a while. DOM manipulation, fetch calls, event listeners. Click a button, something happens. But I had no idea what happened on the other side of those API calls. The `fetch('/api/users')` part was familiar. What came back? Magic, apparently.

That bothered me enough to do something about it.

<!-- truncate -->

## Starting with the basics

In early 2021, I worked through the JavaScript30 challenge. Thirty days of vanilla JS projects. No frameworks, no libraries. Just you, the DOM, and a lot of `addEventListener`. It was fun and it sharpened my fundamentals, but every single project ran entirely in the browser. There was no server. No database. No persistence. Refresh the page, everything's gone.

I wanted to know how the server side worked. What happens when someone submits a form and the data actually needs to go somewhere that isn't `localStorage`.

## Installing Node.js felt too easy

The first thing that surprised me about Node.js was how little setup it needed. I already had JavaScript. I already had npm from various frontend tooling. I ran `npm init`, installed Express, and had a server running in about ten lines:

```javascript
const express = require('express');
const app = express();

app.get('/', (req, res) => {
  res.json({ message: 'Hello from the server' });
});

app.listen(3000, () => {
  console.log('Server running on port 3000');
});
```

I stared at the terminal. `Server running on port 3000`. I opened my browser, went to `localhost:3000`, and there it was. A JSON response. From code I wrote. Running on my machine.

It sounds silly now, but that was the moment the client-server model clicked for me. The browser makes a request. My code handles it. My code decides what to send back.

## The request-response cycle

Once I understood that the server is just a function that takes a request and returns a response, everything else started making sense. Express gives you a clean way to define those functions:

```javascript
app.get('/api/users', (req, res) => {
  // req has everything the client sent
  // res is how I talk back
  res.json(users);
});

app.post('/api/users', (req, res) => {
  const { name, email } = req.body;
  // do something with the data
  res.status(201).json({ name, email });
});
```

The `req` object has the URL, query parameters, headers, body. The `res` object lets me set status codes, headers, and send data back. That's the whole game. Everything else is just details around this core loop.

## Middleware was the first mind-bender

Express middleware confused me for longer than I'd like to admit. The idea that a function can run *before* your route handler, do something to the request, and then pass it along? That's a pattern I hadn't seen in frontend code.

```javascript
app.use(express.json());

app.use((req, res, next) => {
  console.log(`${req.method} ${req.path}`);
  next();
});
```

`next()` was the weird part. In frontend JavaScript, you call a function and it returns. Here, you call `next()` to hand off to the next function in the chain. Once I understood middleware as a pipeline, it made sense. Request comes in, passes through each middleware, eventually hits a route handler. Simple in concept, powerful in practice.

## Building a JWT authentication system

The tutorial I followed built a complete auth system with registration, login, and protected routes. The stack was Node.js 14, Express 4.17, jsonwebtoken 8.5, and bcrypt 5.0.

Registration was straightforward: take the password, hash it with bcrypt, store the hash.

```javascript
const bcrypt = require('bcrypt');

app.post('/api/register', async (req, res) => {
  const { email, password } = req.body;
  const hashedPassword = await bcrypt.hash(password, 10);
  // store user with hashedPassword in database
  res.status(201).json({ message: 'User created' });
});
```

Login was where it got interesting. You don't "log in" with JWT the way you do with sessions. You verify the credentials, then *issue a token*:

```javascript
const jwt = require('jsonwebtoken');

app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  const user = /* find user by email */;
  const valid = await bcrypt.compare(password, user.password);
  
  if (!valid) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const token = jwt.sign(
    { userId: user.id, email: user.email },
    process.env.JWT_SECRET,
    { expiresIn: '24h' }
  );
  
  res.json({ token });
});
```

The client stores this token and sends it with every subsequent request. On the server, you verify it with middleware:

```javascript
function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

app.get('/api/profile', authMiddleware, (req, res) => {
  res.json({ user: req.user });
});
```

That `authMiddleware` pattern clicked for me. It's just a middleware function that checks for a token, verifies it, attaches the decoded user to the request object, and calls `next()`. If there's no token or it's invalid, you send a 401 and stop. The route handler never runs.

## What I got wrong

I stored the JWT secret as a hardcoded string in my code. Real project, committed to Git. I didn't know about `.env` files yet. A senior developer saw my repo and gently pointed out that anyone with access to the code could forge tokens. That was embarrassing but educational.

I also didn't understand HTTP status codes properly. Everything was either 200 or 500. Took me a while to learn when to use 201, 400, 401, 403, 404, 409, and the rest.

And error handling. My first version had no try-catch blocks anywhere. An unhandled promise rejection would crash the entire server. I learned that the hard way when a malformed request body brought down my dev server three times in an hour.

## What stuck

Building that JWT tutorial taught me the fundamentals of backend development. Not because the tutorial was special, but because I built it, broke it, and fixed it myself.

The big takeaways: servers are just functions. Middleware is a pipeline. Authentication is about verifying identity and authorizing access. Passwords should never be stored in plain text. Environment variables exist for a reason.

I was ready to build something real. Something with a team, a database, and actual features. That's where things got messy.
