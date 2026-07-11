---
title: "Building a real app with Express.js and a team"
slug: "building-real-app-expressjs-team"
date: 2021-04-10
category: "Backend"
tags: ["Node.js", "Express", "Sequelize", "MySQL", "JWT", "Backend"]
readingTime: "8 min read"
excerpt: "The JWT tutorial worked. Now I needed to build something real, with other people. Here's what happens when theory meets a team project."
---

The JWT tutorial worked. Auth flow, protected routes, password hashing, the whole thing. I could build a backend that handled users and tokens. But it was a tutorial. Clean code, single developer, no deadlines. Now I needed to build something real, with other people, and with actual requirements that kept changing.

That opportunity came through a coding academy. A team project, Batch 2 Mini Project. The goal: build a web application with user registration, courses, jobs, and categories. Express.js, Sequelize, MySQL. My first real backend project with a team.

<!-- truncate -->

## The tech stack

We used Express 4.17 as the framework (familiar territory), Sequelize 6.2 as the ORM, and MySQL as the database. JWT for authentication, bcrypt for password hashing. Standard stuff for 2021.

The part that was new to me was Sequelize. I'd only worked with raw SQL queries in the JWT tutorial. Sequelize lets you define models in JavaScript and it handles the SQL for you:

```javascript
const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const User = sequelize.define('User', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  name: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  email: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true,
  },
  password: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  role: {
    type: DataTypes.ENUM('user', 'admin'),
    defaultValue: 'user',
  },
});

module.exports = User;
```

No more writing `CREATE TABLE` statements. No more string-concatenated SQL queries. You define the shape of your data in JavaScript, and Sequelize creates the tables, handles relationships, and generates the queries.

Was it better than raw SQL? For getting started, absolutely. Did it hide things I should have understood? Also yes.

## MVC and project structure

We followed the MVC pattern. Models for the data, controllers for the logic, routes for the endpoints. Plus a middleware folder for auth and validation:

```
src/
  config/
    database.js
  models/
    User.js
    Course.js
    Job.js
    Category.js
  controllers/
    authController.js
    courseController.js
    jobController.js
  middleware/
    auth.js
    validate.js
  routes/
    authRoutes.js
    courseRoutes.js
    jobRoutes.js
  app.js
```

Routes were clean. Import the controller, attach it to an Express Router:

```javascript
const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const auth = require('../middleware/auth');

router.post('/register', authController.register);
router.post('/login', authController.login);
router.get('/profile', auth, authController.getProfile);

module.exports = router;
```

Then in `app.js`, mount each router:

```javascript
const authRoutes = require('./routes/authRoutes');
const courseRoutes = require('./routes/courseRoutes');

app.use('/api/auth', authRoutes);
app.use('/api/courses', courseRoutes);
```

This pattern made sense. Each file has one job. Routes map URLs to controller functions. Controllers handle the request and call the models. Models talk to the database. Clean separation.

## Sequelize migrations: the part nobody warns you about

Sequelize has this thing called migrations. They're version-controlled changes to your database schema. Add a column, create a table, change a data type. Each change is a migration file with an `up` and a `down` function.

```javascript
module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn('Users', 'phone', {
      type: Sequelize.STRING,
      allowNull: true,
    });
  },
  down: async (queryInterface, Sequelize) => {
    await queryInterface.removeColumn('Users', 'phone');
  },
};
```

In theory, migrations are great. Everyone on the team runs the same migrations, the database stays in sync, and you can roll back changes.

In practice, we constantly broke each other's migrations. Someone would add a column, push the code, and the rest of us would pull and try to run migrations. If your local database was in a slightly different state, the migration would fail. We'd spend twenty minutes debugging why `addColumn` was complaining about a column that already existed.

The fix was simple once we figured it out: always pull latest, always run migrations before doing anything else. But that lesson cost us several hours of frustration.

## The hotfix cycle

Here's something tutorials don't prepare you for: bugs that only show up when multiple people are building different features at the same time.

We had a middleware that checked if the user was authenticated. Simple enough, it worked in the JWT tutorial. But in this project, we also needed role-based authorization. Admin users could create courses and jobs. Regular users could only view them.

The first version of our authorization middleware looked like this:

```javascript
const authorize = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        error: 'You do not have permission to perform this action',
      });
    }
    next();
  };
};
```

Applied to routes:

```javascript
router.post('/courses', auth, authorize('admin'), courseController.create);
router.get('/courses', courseController.getAll);
```

This worked until it didn't. The middleware ran in order: `auth` first (verifies the token, attaches `req.user`), then `authorize` (checks the role). But someone refactored the auth middleware and accidentally removed the line that attached the user to the request. The authorize middleware would crash with `Cannot read property 'role' of undefined`.

Three hotfixes later, we added proper null checks:

```javascript
const authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        error: 'You do not have permission',
      });
    }
    next();
  };
};
```

Defensive programming. Assume everything can be null. It's annoying, but it prevents the kind of bugs that are hard to track down when three people are pushing code at the same time.

## ORM vs raw SQL

Sequelize made simple queries easy:

```javascript
const courses = await Course.findAll({
  include: [{ model: Category, as: 'category' }],
  where: { isActive: true },
  limit: 10,
  offset: 0,
});
```

That generates a JOIN, a WHERE clause, and pagination. One line of JavaScript, no SQL to write. For CRUD operations, the ORM was great.

But when we needed more complex queries, things got awkward. We needed to find users who were enrolled in at least two courses and had completed at least one. In raw SQL, that's a GROUP BY with HAVING. In Sequelize, we ended up with something like this:

```javascript
const users = await User.findAll({
  attributes: [
    'id', 'name', 'email',
    [sequelize.fn('COUNT', sequelize.col('Enrollments.id')), 'enrollmentCount'],
  ],
  include: [{
    model: Enrollment,
    attributes: [],
    where: { completed: true },
  }],
  group: ['User.id'],
  having: sequelize.literal('COUNT(Enrollments.id) >= 2'),
});
```

It worked, but it was harder to read than the equivalent SQL. And when it generated the wrong query (which happened), debugging was painful because you had to figure out what SQL Sequelize was actually generating.

Lesson learned: ORMs are great for simple operations. For complex queries, sometimes raw SQL is clearer. Sequelize supports raw queries too, and we should have used them more.

## Git with a team

We used feature branches. Each feature got its own branch, we'd make a pull request, someone would review it (loosely), and merge it to main.

The merge conflicts were constant. We were all editing the same files, especially `app.js` (where routes were mounted) and the migration folder. I learned to pull frequently and merge often. Small, frequent commits beat big ones that touch everything.

We didn't have CI/CD. No automated tests. No linting rules enforced. Code reviews were "looks good to me" without much scrutiny. It was a learning project, and we learned a lot, but the quality bar was low. That's honest.

## What I took away

Building with a team taught me things no tutorial could. Communication matters. Code structure matters more when multiple people touch it. Defensive programming prevents the bugs that are hardest to debug. And ORMs are tools with trade-offs, not magic.

The project was messy. The code had issues. We shipped hotfixes for things that should have been caught earlier. But that's what building something real looks like when you're learning. You make mistakes, you fix them, and you remember the lesson.

Next up: I wanted to see what backend development looked like outside the JavaScript ecosystem. Java and Spring Boot were calling, and the learning curve was steep.
