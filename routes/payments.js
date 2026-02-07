const router = require('express').Router();
const Transaction = require('../models/Transaction');
const auth = require('../middleware/auth');

// SUBMIT PAYMENT PROOF
router.post('/submit', auth, async (req, res) => {
  try {
    const { method, transactionId, amount } = req.body;
    
    const existing = await Transaction.findOne({ transactionId });
    if (existing) return res.status(400).json({ message: "Transaction ID already used." });

    const newTx = new Transaction({
      user: req.user.id,
      method,
      transactionId,
      amount
    });

    await newTx.save();
    res.json({ message: "Payment proof transmitted. Awaiting Architect verification." });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
