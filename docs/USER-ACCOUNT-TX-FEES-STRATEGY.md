Main objective is for the wallet to be as simple as possible.

We need to top-up the ETH balance on base automatically so the user can operate without having to worry about the ETH balance.

In Base blockchain, 0.00001 ETH (1e-5 ETH) is the expected amount to have in the wallet to perform one ERC-20 approval and up to four ERC-20 transfers.

If the wallet has less than 1e-5 ETH, we need to top-up the wallet to 1.5e-5 ETH.

So on every transfer we charge a FEE measured in the transferred ERC-20 tokens, we send that fee to a FEE contract, and the FEE contract will top-up the wallet to 1.5e-5 ETH.

We also need to simplify the process for the receptor of the ERC-20 transfer, so the FEE contract will also top-up (if needed) the ETH balance on the informed receiver's wallet to 1e-5 ETH.

