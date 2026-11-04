// Lesson cards. All lesson text lives here.
//
// id:      unique name, saved once the card has been shown
// trigger: a name that game.js checks (see LESSON_TRIGGERS in game.js)
// title, body: original text, two to four short sentences each
//
// Every card links to the B2B page (CONFIG.b2bPageUrl) using `linkText`.
const LESSONS = [
  {
    id: "cost-per-tee",
    trigger: "first-order-seen",
    title: "Know your cost per tee",
    body:
      "Cost per tee is everything you spend to make one finished shirt: the blank, the ink, " +
      "the screen, the labour and the packaging. Add it up before you set a price, or you can " +
      "sell a hundred shirts and still lose money. Look at the table on each order and find " +
      "the line that costs the most.",
    linkText: "Get help pricing your own line",
  },
  {
    id: "moq",
    trigger: "below-moq-order",
    title: "Minimum order quantity (MOQ)",
    body:
      "Suppliers set a minimum order quantity because a small run takes them almost as much " +
      "effort as a big one. Order fewer than the minimum and you usually pay extra per piece, " +
      "which is the surcharge you just saw. Check a supplier's minimum before you promise a " +
      "small order to a customer.",
    linkText: "See how to work with suppliers",
  },
  {
    id: "gsm",
    trigger: "first-blanks-bought",
    title: "What GSM means",
    body:
      "GSM stands for grams per square metre, and it tells you how heavy a fabric is. A light " +
      "tee around 150 GSM feels thin and cool, while 220 GSM and up feels thick and premium. " +
      "Heavier cloth costs more per blank, so pick the weight that suits your customer and " +
      "your price.",
    linkText: "Choose the right blanks for your brand",
  },
  {
    id: "print-method",
    trigger: "first-unlock",
    title: "Pick the right print method",
    body:
      "Screen printing is cheap per shirt on big runs because you pay for the screen once. " +
      "DTG prints full colour straight onto the fabric with no screen, so it suits small runs, " +
      "but the ink costs more. Embroidery lasts the longest and looks premium, but it is slow " +
      "and has a setup fee for the stitch file. Match the method to the order size and the " +
      "look the customer wants.",
    linkText: "Find the best print method for your order",
  },
  {
    id: "deadstock",
    trigger: "bulk-discount-order",
    title: "Deadstock: stock that does not sell",
    body:
      "Deadstock is stock you bought but cannot sell, like shirts in the wrong size or a design " +
      "nobody wants any more. Bulk discounts make a big order look cheap per tee, but every " +
      "unsold shirt is cash sitting on a shelf. Only buy in bulk when you know the orders are " +
      "coming. The word can also mean leftover fabric from big brands, sold cheaply, which only " +
      "pays off if you use it all.",
    linkText: "Plan your stock without wasting money",
  },
  {
    id: "returns",
    trigger: "first-order-shipped",
    title: "Plan for returns",
    body:
      "Some customers send products back: a misprint, the wrong size, a shirt that arrived " +
      "damaged. Every return costs you the product, the shipping both ways and your time, so " +
      "one return can wipe out the profit from several sales. Check quality before you pack " +
      "and keep a little margin aside for the ones that slip through.",
    linkText: "Learn how to cut down returns",
  },
];
