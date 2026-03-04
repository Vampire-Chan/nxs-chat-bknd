const router = require('express').Router();
const Transaction = require('../models/Transaction');
const auth = require('../middleware/auth');

// SUBMIT PAYMENT PROOF
router.post('/submit', auth, async (req, res) => {
  try {
    const { method, transactionId, amount } = req.body;
    
    if (!method || !transactionId || !amount) {
      return res.status(400).json({ message: "Method, transaction ID, and amount are required." });
    }
    if (typeof amount !== 'number' || amount <= 0) {
      return res.status(400).json({ message: "Invalid amount." });
    }
    if (typeof transactionId !== 'string' || transactionId.length > 128) {
      return res.status(400).json({ message: "Invalid transaction ID." });
    }
    
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

// GET TRANSACTION HISTORY
router.get('/me', auth, async (req, res) => {
  try {
    const txs = await Transaction.find({ user: req.user.id }).sort({ createdAt: -1 });
    res.json(txs);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
