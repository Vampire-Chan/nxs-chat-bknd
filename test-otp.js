const otplib = require('otplib');

const secret = otplib.generateSecret();
console.log('Secret:', secret);

try {
  // Try object signature
  const token = otplib.generate({ secret });
  console.log('Token:', token);

  const isValid = otplib.verify({ token, secret });
  console.log('Verify:', isValid);
} catch(e) { console.log('Auth Error:', e.message); }

try {
  // keyuri signature check
  // usually keyuri(user, issuer, secret)
  // v13 generateURI might be generic.
  // Docs say: authenticator.keyuri(user, service, secret)
  
  // Let's try otplib.keyuri if it exists?
  if (otplib.keyuri) {
      console.log('keyuri exists');
      const uri = otplib.keyuri('user', 'service', secret);
      console.log('URI:', uri);
  } else {
      console.log('keyuri missing, trying generateURI');
      // maybe generateURI({ secret, label, issuer })??
      const uri = otplib.generateURI({ secret, label: 'user', issuer: 'service' });
      console.log('URI:', uri); // Expect promise??
  }
} catch(e) { console.log('URI Error:', e.message); }
