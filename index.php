<html>
    <head>
        <title>Project_Edu</title>
        <link rel="preconnect" href="https://fonts.gstatic.com">
        <link rel="stylesheet" type="text/css" href="./php/style.css">
    </head>
<body>
    <div class="login-proc">
        <h3>Login</h3>
        <input type="email" placeholder="Email" id='email'/>
        <input type="password" placeholder="Password" id='password'/>

        <button onclick="loginfunc()">Login</button>
        <button onclick='window.location = "./pages/signup.html";'>sign up</button>
    </div>

    <script src="login.js"></script>

<!-- The core Firebase JS SDK is always required and must be listed first -->
<script src="https://www.gstatic.com/firebasejs/8.3.0/firebase-app.js"></script>
<script src="https://www.gstatic.com/firebasejs/8.3.0/firebase-firestore.js"></script>
<script src="https://www.gstatic.com/firebasejs/8.3.0/firebase-auth.js"></script>

<!-- TODO: Add SDKs for Firebase products that you want to use
     https://firebase.google.com/docs/web/setup#available-libraries -->
<script src="https://www.gstatic.com/firebasejs/8.3.0/firebase-analytics.js"></script>

<script src="firebaseconfig.js"></script>
</body>
</html>
