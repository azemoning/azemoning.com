---
title: "What I learned building a banking backend"
slug: "what-i-learned-building-banking-backend"
date: 2021-08-10
category: "Backend"
tags: ["Spring Boot", "Java", "JWT", "Spring Security", "Backend", "Architecture"]
readingTime: "10 min read"
excerpt: "A banking app needs more than CRUD. It needs authentication that actually works, transactions that don't lose money, and an architecture that doesn't collapse when you add features."
---

A banking app needs more than CRUD. You can't just slap a REST controller on a database table and call it done. It needs authentication that actually works. Transactions that don't lose money. Authorization that distinguishes between a regular user and an admin. And an architecture that doesn't collapse when you add features on top of features.

That's what the Jalin project demanded. Spring Boot 2.5, Java 11, Maven. Modules for authentication, banking, dashboard, and gamification. Each module with its own entities, repositories, services, and controllers. JWT authentication with Spring Security. Role-based access control. Deployed to Heroku with GitLab CI/CD.

This was the project where I stopped being a beginner following tutorials and started making real architectural decisions. Some of them were good. Some I'd change today.

<!-- truncate -->

## Module-based architecture

The Express projects I'd built were organized by technical layer: controllers here, models there, routes over there. It works for small apps. It falls apart when you have twenty models and thirty controllers all in the same folders.

For Jalin, we organized by feature instead. Each module was its own logical unit:

```
com.jalin.app/
  module/
    authentication/
      entity/
        User.java
        RoleEnum.java
        AuthorityEnum.java
      repository/
        UserRepository.java
      service/
        AuthenticationService.java
      presenter/
        AuthenticationController.java
    banking/
      entity/
        Transfer.java
        Payment.java
        Wallet.java
      repository/
        TransferRepository.java
        PaymentRepository.java
      service/
        TransferService.java
        PaymentService.java
      presenter/
        BankingController.java
    dashboard/
      entity/
        TransactionDetail.java
      service/
        DashboardService.java
      presenter/
        DashboardController.java
    gamification/
      entity/
        Voucher.java
        Mission.java
        Points.java
        CheckIn.java
      service/
        GamificationService.java
      presenter/
        GamificationController.java
```

"Presenter" was what we called controllers. Not my naming choice, but it stuck. Each module had its own entities, repositories, services, and presenters. When you needed to understand the banking feature, you looked in the `banking` folder. Everything was there.

Cross-module communication happened through services. The dashboard service might call the banking service to get transaction details. That created dependencies between modules, which we managed by keeping the service interfaces clean.

## Spring Security the old way

This was Spring Security before version 6. The configuration style was different. You extended `WebSecurityConfigurerAdapter` and overrode the `configure` method:

```java
@Configuration
@EnableWebSecurity
public class SecurityConfiguration extends WebSecurityConfigurerAdapter {

    @Autowired
    private JwtFilter jwtFilter;

    @Override
    protected void configure(HttpSecurity http) throws Exception {
        http
            .csrf().disable()
            .authorizeRequests()
                .antMatchers("/api/auth/**").permitAll()
                .antMatchers("/api/admin/**").hasRole("ADMIN")
                .anyRequest().authenticated()
            .and()
            .sessionManagement()
                .sessionCreationPolicy(SessionCreationPolicy.STATELESS)
            .and()
            .addFilterBefore(jwtFilter, UsernamePasswordAuthenticationFilter.class);
    }

    @Bean
    public PasswordEncoder passwordEncoder() {
        return new BCryptPasswordEncoder();
    }
}
```

The chain method calls (`.and()`, `.csrf().disable()`) felt clunky compared to Express middleware, but the logic was clear: disable CSRF (we're using tokens, not cookies), define which URLs are public, require authentication for everything else, and add our JWT filter before the default username-password filter.

Stateless sessions were important. We weren't using server-side sessions. Every request carried its own JWT. The server verified the token on every request. No session storage, no session cookies.

## The JWT filter

The filter was a class extending `OncePerRequestFilter`. Spring calls it once per request (the name is literal), and it runs before any controller:

```java
@Component
public class JwtFilter extends OncePerRequestFilter {

    @Autowired
    private JwtUtil jwtUtil;

    @Autowired
    private UserDetailsService userDetailsService;

    @Override
    protected void doFilterInternal(
            HttpServletRequest request,
            HttpServletResponse response,
            FilterChain filterChain) throws ServletException, IOException {

        String authHeader = request.getHeader("Authorization");

        if (authHeader != null && authHeader.startsWith("Bearer ")) {
            String token = authHeader.substring(7);
            
            try {
                String username = jwtUtil.extractUsername(token);
                
                if (username != null && 
                    SecurityContextHolder.getContext().getAuthentication() == null) {
                    
                    UserDetails userDetails = 
                        userDetailsService.loadUserByUsername(username);
                    
                    if (jwtUtil.validateToken(token, userDetails)) {
                        UsernamePasswordAuthenticationToken authToken =
                            new UsernamePasswordAuthenticationToken(
                                userDetails, null, userDetails.getAuthorities());
                        authToken.setDetails(
                            new WebAuthenticationDetailsSource()
                                .buildDetails(request));
                        SecurityContextHolder.getContext()
                            .setAuthentication(authToken);
                    }
                }
            } catch (Exception e) {
                logger.error("JWT authentication failed", e);
            }
        }

        filterChain.doFilter(request, response);
    }
}
```

This is verbose. I know. Compare it to the Express version:

```javascript
function authMiddleware(req, res, next) {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'No token' });
    
    try {
        req.user = jwt.verify(token, JWT_SECRET);
        next();
    } catch (err) {
        return res.status(401).json({ error: 'Invalid token' });
    }
}
```

The Java version does the same thing but with more ceremony. Extract the token, validate it, load the user details, create an authentication token, set it in the security context. Every step is explicit. Every step requires multiple objects.

But there's a benefit to the verbosity: you can see exactly what happens. The security context, the authentication token, the user details service. Each piece is visible and testable.

## Role-based access control

We defined roles and authorities as enums:

```java
public enum RoleEnum {
    ROLE_USER,
    ROLE_ADMIN
}

public enum AuthorityEnum {
    READ,
    CREATE,
    UPDATE,
    DELETE
}
```

Roles mapped to sets of authorities. ROLE_USER had READ. ROLE_ADMIN had all four. The security configuration enforced these:

```java
.antMatchers(HttpMethod.GET, "/api/**").hasAuthority("READ")
.antMatchers(HttpMethod.POST, "/api/**").hasAuthority("CREATE")
.antMatchers(HttpMethod.DELETE, "/api/**").hasAuthority("DELETE")
```

In the controllers, we could also check roles programmatically:

```java
@GetMapping("/admin/users")
public List<User> getAllUsers() {
    Authentication auth = SecurityContextHolder.getContext().getAuthentication();
    boolean isAdmin = auth.getAuthorities().stream()
        .anyMatch(a -> a.getAuthority().equals("ROLE_ADMIN"));
    
    if (!isAdmin) {
        throw new UnauthorizedException("Admin access required");
    }
    return userService.findAll();
}
```

This was redundant (the SecurityConfiguration already enforced it), but it was a learning exercise. We were figuring out how Spring Security worked by trying different approaches.

## Custom exceptions and @ControllerAdvice

Every module could throw specific exceptions. The banking module might throw `InsufficientBalanceException`. The authentication module might throw `InvalidCredentialsException`. We caught them all in one place:

```java
@ControllerAdvice
public class GlobalExceptionHandler {

    @ExceptionHandler(InsufficientBalanceException.class)
    public ResponseEntity<ErrorResponse> handleInsufficientBalance(
            InsufficientBalanceException ex) {
        ErrorResponse error = new ErrorResponse(
            HttpStatus.BAD_REQUEST.value(),
            ex.getMessage(),
            LocalDateTime.now()
        );
        return new ResponseEntity<>(error, HttpStatus.BAD_REQUEST);
    }

    @ExceptionHandler(UnauthorizedException.class)
    public ResponseEntity<ErrorResponse> handleUnauthorized(
            UnauthorizedException ex) {
        ErrorResponse error = new ErrorResponse(
            HttpStatus.UNAUTHORIZED.value(),
            ex.getMessage(),
            LocalDateTime.now()
        );
        return new ResponseEntity<>(error, HttpStatus.UNAUTHORIZED);
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<ErrorResponse> handleGeneral(Exception ex) {
        ErrorResponse error = new ErrorResponse(
            HttpStatus.INTERNAL_SERVER_ERROR.value(),
            "An unexpected error occurred",
            LocalDateTime.now()
        );
        return new ResponseEntity<>(error, HttpStatus.INTERNAL_SERVER_ERROR);
    }
}
```

`@ControllerAdvice` is Spring's way of creating global error handlers. When any controller throws an exception, Spring checks if there's an `@ExceptionHandler` for it. If there is, that handler runs instead of the default error page.

This pattern was cleaner than try-catch blocks in every controller method. Define your custom exceptions, throw them where appropriate, handle them centrally. The controller code stays clean.

## External API calls with RestTemplate

The gamification module needed to call external services. We used `RestTemplate`, which is Spring's HTTP client:

```java
@Service
public class GamificationService {

    private final RestTemplate restTemplate;

    public GamificationService() {
        this.restTemplate = new RestTemplate();
    }

    public VoucherResponse claimVoucher(String voucherCode, Long userId) {
        String url = "https://api.partner.com/vouchers/" + voucherCode;
        
        HttpHeaders headers = new HttpHeaders();
        headers.set("Authorization", "Bearer " + partnerApiKey);
        
        HttpEntity<Void> request = new HttpEntity<>(headers);
        
        ResponseEntity<VoucherResponse> response = restTemplate.exchange(
            url, HttpMethod.GET, request, VoucherResponse.class);
        
        return response.getBody();
    }
}
```

`RestTemplate` is synchronous. It blocks the thread until the external API responds. For a learning project, that was fine. In production, you'd want `WebClient` (reactive) or at least async calls with `CompletableFuture`.

We also used Faker to generate seed data for testing. Hundreds of fake users, transactions, and vouchers. It made manual testing much easier.

## CI/CD with GitLab and Heroku

Our deployment pipeline was GitLab CI. A `.gitlab-ci.yml` file defined the stages:

```yaml
stages:
  - build
  - test
  - deploy

build:
  stage: build
  script:
    - mvn clean package -DskipTests
  artifacts:
    paths:
      - target/*.jar

test:
  stage: test
  script:
    - mvn test

deploy:
  stage: deploy
  script:
    - apt-get update && apt-get install -y ruby ruby-dev
    - gem install dpl
    - dpl --provider=heroku --app=jalin-api --api-key=$HEROKU_API_KEY
  only:
    - main
```

Push to main, GitLab builds the JAR, runs tests, and deploys to Heroku. The whole process took about five minutes. Not fast, but automatic.

Heroku was free at the time (they've since removed the free tier). It was the easiest way to get a Spring Boot app running on the internet. You push a JAR, Heroku runs it. Environment variables for configuration. Simple.

## What I'd do differently

Knowing what I know now, here's what I'd change:

**Use Lombok.** We wrote getters and setters for every field in every entity. Hundreds of lines of boilerplate. Lombok's `@Data` annotation generates all of that automatically. We didn't know about it at the time.

**Write tests.** We had zero automated tests. Zero. The GitLab CI pipeline ran `mvn test`, but there were no tests to run. Every change was tested manually through Postman. That's a fragile way to build software.

**Use WebClient instead of RestTemplate.** RestTemplate is fine for simple calls, but it's blocking and doesn't handle timeouts well. WebClient is the modern alternative.

**Structure the security config differently.** We put all the authorization rules in one big `configure` method. For a larger app, that gets unwieldy. Splitting security config by module would have been cleaner.

**Validate inputs properly.** We relied too much on the entity annotations for validation. Bean validation (`@Valid`, `@NotNull`, `@Size`) is fine, but it's not enough for complex business rules. Those belong in the service layer.

## What the banking project taught me

Architecture matters. When you have four modules with dozens of classes, how you organize them determines whether the codebase is navigable or a maze. Module-based organization worked well for us.

Security is a layer, not an afterthought. Spring Security's filter chain runs before any controller. Authentication and authorization are handled centrally, not scattered across route handlers. That's the right way to do it.

Production concerns are real. CI/CD, error handling, logging, environment configuration. None of these are exciting, but all of them are necessary. The Express projects I'd built earlier ignored most of these. The banking project forced me to deal with them.

And Java's verbosity, which frustrated me at first, started making sense. When you're building something that handles money, explicit is better than implicit. Every type is declared. Every exception is handled. Every access rule is defined. There's less room for the kind of ambiguity that causes bugs.

That's not to say Java is always the right choice. For quick prototypes and small services, Express is still faster to build with. But for something that needs to be reliable, maintainable, and secure, Spring Boot earned my respect.

I went from "callbacks are fine" to "dependency injection makes sense." That took four months, three projects, and a lot of confused debugging sessions. Worth it.
