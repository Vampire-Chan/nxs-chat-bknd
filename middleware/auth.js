const jwt = require('jsonwebtoken');
const User = require('../models/User');
const sanitize = require('mongo-sanitize');

module.exports = async function (req, res, next) {
  // Sanitize all inputs to prevent NoSQL injection
  req.body = sanitize(req.body);
  req.query = sanitize(req.query);
  req.params = sanitize(req.params);

  // Get token from header
  const token = req.header('x-auth-token');

  // Check if not token
  if (!token) {
    return res.status(401).json({ msg: 'No token, authorization denied' });
  }

  // Verify token
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Live Check: Ensure user still exists and is not banned/disabled
    const user = await User.findById(decoded.id).select('isDisabled').lean();
    if (!user || user.isDisabled) {
      return res.status(401).json({ msg: 'Identity node severed or inactive.' });
    }

    req.user = decoded;
    // Normalize id
    if (req.user._id && !req.user.id) req.user.id = req.user._id;
    next();
  } catch (err) {
    res.status(401).json({ msg: 'Token is not valid' });
  }
};
