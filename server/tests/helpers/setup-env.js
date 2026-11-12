// Runs before each test file; gives env.js valid values without touching real services.
process.env.NODE_ENV = 'test';
process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/placeholder'; // tests use an in-memory DB
process.env.CLIENT_ORIGIN = 'http://localhost:5173';
process.env.JWT_ACCESS_SECRET = 'test-secret-test-secret-test-secret-123';
process.env.BCRYPT_COST = '10';
process.env.LOGIN_MAX_FAILS = '5';
process.env.LOGIN_WINDOW_MIN = '15';
process.env.SENDGRID_API_KEY = '';
