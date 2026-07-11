---
title: "Why I tried Spring Boot (and what confused me)"
slug: "why-i-tried-spring-boot-and-what-confused-me"
date: 2021-06-25
category: "Backend"
tags: ["Spring Boot", "Java", "PostgreSQL", "Backend", "Learning"]
readingTime: "9 min read"
excerpt: "Everything in Node.js is a callback. In Spring Boot, nothing is. The mental model is completely different, and switching was harder than I expected."
---

Everything in Node.js is a callback. You pass a function to a function, and when the thing is done, your function runs. Request comes in, handle it, send a response. You write the flow yourself, top to bottom.

In Spring Boot, nothing is. You annotate a class, and the framework finds it. You annotate a method, and the framework calls it. You define an interface, and the framework implements it. You don't control the flow. The framework does.

Switching from Express.js to Spring Boot wasn't just learning a new language. It was learning a completely different way of thinking about how software is organized. And for the first two weeks, I hated it.

<!-- truncate -->

## Why switch at all

After building the team project with Express and Sequelize, I had a decent grasp of backend fundamentals. Routes, middleware, authentication, database interaction. But I kept hearing that most enterprise backend work was in Java. Job listings confirmed it. Spring Boot was everywhere.

I also wanted to understand what I was missing. Node.js felt comfortable, but I suspected that comfort was limiting my perspective. I wanted to see how the other half builds servers.

So I installed Java 11, Maven, and Spring Boot 2.5. And immediately felt lost.

## The dependency injection confusion

In Express, if you need something, you import it:

```javascript
const User = require('../models/User');
const bcrypt = require('bcrypt');

// Use them directly
const hashed = await bcrypt.hash(password, 10);
```

In Spring Boot, if you need something, you... don't import it. You ask the framework to give it to you:

```java
@Service
public class UserService {
    
    private final UserRepository userRepository;
    private final PasswordEncoder passwordEncoder;

    public UserService(UserRepository userRepository, 
                       PasswordEncoder passwordEncoder) {
        this.userRepository = userRepository;
        this.passwordEncoder = passwordEncoder;
    }

    public User createUser(String name, String email, String password) {
        User user = new User();
        user.setName(name);
        user.setEmail(email);
        user.setPassword(passwordEncoder.encode(password));
        return userRepository.save(user);
    }
}
```

I stared at this for a long time. Where does `UserRepository` come from? Who creates it? Who passes it to the constructor? I didn't call `new UserService(...)` anywhere. Nobody did. It just... existed.

That's dependency injection. Spring Boot creates the objects (called "beans") and wires them together. You define what you need, and the framework figures out how to provide it. The `@Service` annotation tells Spring "this class is a service, please manage it." The constructor says "I need a UserRepository and a PasswordEncoder." Spring finds or creates those beans and injects them.

It's powerful once you get it. But coming from JavaScript, where you control object creation explicitly, it felt like magic. And magic makes debugging hard.

## Annotations everywhere

Java is verbose. That's not a secret. But Spring Boot uses annotations to reduce the boilerplate. A lot of annotations:

```java
@RestController
@RequestMapping("/api/users")
public class UserController {

    @Autowired
    private UserService userService;

    @GetMapping
    public List<User> getAllUsers() {
        return userService.findAll();
    }

    @GetMapping("/{id}")
    public User getUserById(@PathVariable Long id) {
        return userService.findById(id);
    }

    @PostMapping
    public User createUser(@RequestBody User user) {
        return userService.save(user);
    }
}
```

`@RestController` marks this as a controller. `@RequestMapping` sets the base path. `@GetMapping` and `@PostMapping` map HTTP methods. `@PathVariable` extracts URL parameters. `@RequestBody` parses the request body. `@Autowired` injects dependencies.

Each annotation is simple on its own. But when you're new, seeing ten annotations on a class and not knowing what any of them do is overwhelming. I spent the first week constantly Googling what each annotation did.

The Express equivalent is more explicit and, honestly, easier to follow when you're starting out:

```javascript
const router = express.Router();

router.get('/api/users', async (req, res) => {
  const users = await User.findAll();
  res.json(users);
});

router.get('/api/users/:id', async (req, res) => {
  const user = await User.findByPk(req.params.id);
  res.json(user);
});

router.post('/api/users', async (req, res) => {
  const user = await User.create(req.body);
  res.json(user);
});
```

Same functionality. Less magic. You can read it top to bottom and understand exactly what happens.

## Maven vs npm

Maven is Java's package manager, comparable to npm. But the experience is very different.

A `pom.xml` file (Maven's equivalent of `package.json`) looks like this:

```xml
<project>
    <parent>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-starter-parent</artifactId>
        <version>2.5.0</version>
    </parent>
    
    <dependencies>
        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-web</artifactId>
        </dependency>
        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-data-jpa</artifactId>
        </dependency>
        <dependency>
            <groupId>org.postgresql</groupId>
            <artifactId>postgresql</artifactId>
            <scope>runtime</scope>
        </dependency>
    </dependencies>
</project>
```

XML. In 2021. After years of JSON `package.json` files, this felt ancient. And Maven's dependency resolution is opaque compared to npm. When something goes wrong in npm, you can usually figure it out. When something goes wrong in Maven, the error messages are... Java error messages.

The build process is also different. `npm start` runs your app. `mvn spring-boot:run` does the same, but first it compiles everything. Java is compiled, JavaScript is interpreted. That adds time. A Spring Boot app restart takes seconds. An Express server restart is instant.

These differences sound small. They add up. Every change, every test, every debug cycle is a bit slower in Java. When you're learning and iterating quickly, that friction is noticeable.

## JPA vs Sequelize

Both are ORMs. Both map database tables to objects. But the approaches are different.

Sequelize uses a model-definition pattern:

```javascript
const User = sequelize.define('User', {
  name: DataTypes.STRING,
  email: DataTypes.STRING,
});
```

Spring Data JPA uses interfaces and annotations:

```java
@Entity
@Table(name = "users")
public class User {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;
    
    private String name;
    private String email;
    
    // getters and setters (yes, you need them)
}
```

```java
public interface UserRepository extends JpaRepository<User, Long> {
    List<User> findByEmail(String email);
}
```

The repository pattern was the weird part. You define an interface, and Spring Data JPA creates the implementation at runtime. You write `findByEmail` in the interface, and Spring figures out that means `SELECT * FROM users WHERE email = ?`.

No implementation code. The framework generates it from the method name. That's powerful, but it's also the kind of thing that makes you question whether you actually understand what's happening.

PostgreSQL was our database. Connecting it to Spring Boot required just a few lines in `application.properties`:

```properties
spring.datasource.url=jdbc:postgresql://localhost:5432/mydb
spring.datasource.username=postgres
spring.datasource.password=password
spring.jpa.hibernate.ddl-auto=update
```

`ddl-auto=update` tells Hibernate (the JPA implementation) to automatically update the database schema based on your entity classes. Convenient for development, terrifying for production.

## The first CRUD app

My first Spring Boot project was a simple CRUD app. Users, posts, comments. The classic tutorial project. Spring Boot 2.5, Java 11, PostgreSQL, Maven.

The structure was the standard Spring Boot layout:

```
src/main/java/com/example/app/
  controller/
    UserController.java
    PostController.java
  service/
    UserService.java
    PostService.java
  repository/
    UserRepository.java
    PostRepository.java
  model/
    User.java
    Post.java
  Application.java
```

Controller, service, repository, model. Each layer has a job. Controllers handle HTTP. Services contain business logic. Repositories talk to the database. Models define the data.

It's more layers than Express MVC. In Express, a controller function can directly query the database through a model. In Spring Boot, you go through a service layer. Always.

I initially thought this was unnecessary overhead. Why have a service class that just calls the repository? But as the application grew, the service layer started making sense. Business logic that didn't belong in the controller or the repository lived there. Validation, calculations, coordination between multiple repositories.

## What clicked and what didn't

What clicked: the structure. Spring Boot projects all look similar. You know where to find things. The controller handles HTTP, the service has logic, the repository has queries. That consistency makes large codebases navigable.

What didn't click: the magic. Annotations that do things behind the scenes. Beans that appear from nowhere. Exceptions that are thrown by the framework with stack traces twenty levels deep. Coming from Express, where you can trace every function call, this was disorienting.

What frustrated me: the verbosity. getters and setters for every field. Classes that are mostly boilerplate. (Lombok helps, but it's another piece of magic to learn.) The compilation step. The XML configuration. The sheer number of files you need for a simple endpoint.

What I appreciated later: the type safety. Java catches errors at compile time that JavaScript would only catch at runtime. Refactoring is safer because the compiler verifies everything. And the dependency injection, once I understood it, made testing much easier.

I was building my first Spring Boot app, but I had no idea that a much bigger project was coming. A banking backend that would push me to learn Spring Security, JWT filters, and module-based architecture the hard way.
