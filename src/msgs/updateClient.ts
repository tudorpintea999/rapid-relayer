import { getSignedHeader } from "./signedHeader";
import { MsgUpdateClient } from "@initia/initia.js/dist/core/ibc/core/client/msgs";
import { Chain } from "src/chain";
import { Header } from "cosmjs-types/ibc/lightclients/tendermint/v1/tendermint";
import {
  ValidatorSet,
  Validator,
} from "cosmjs-types/tendermint/types/validator";
import { Height } from "cosmjs-types/ibc/core/client/v1/client";

export async function generateMsgUpdateClient(
  srcChain: Chain,
  destChain: Chain
): Promise<{
  msg: MsgUpdateClient;
  height: Height;
}> {
  const latestHeight = Number(
    (await destChain.lcd.ibc.clientState(destChain.clientId)).client_state
      .latest_height.revision_height
  );
  const signedHeader = await getSignedHeader(srcChain);
  const currentHeight = Number(signedHeader.header.height);
  const validatorSet = await getValidatorSet(srcChain, currentHeight);
  const trustedHeight = getRevisionHeight(
    latestHeight,
    signedHeader.header.chainId
  );
  const trustedValidators = await getValidatorSet(srcChain, latestHeight + 1);

  const tmHeader = {
    typeUrl: "/ibc.lightclients.tendermint.v1.Header",
    value: Header.encode(
      Header.fromPartial({
        signedHeader,
        validatorSet,
        trustedHeight,
        trustedValidators,
      })
    ).finish(),
  };

  const revisionHeight = getRevisionHeight(
    currentHeight,
    signedHeader.header.chainId
  );

  return {
    msg: new MsgUpdateClient(
      destChain.clientId,
      tmHeader,
      destChain.wallet.address()
    ),
    height: revisionHeight,
  };
}

const regexRevNum = new RegExp("-([1-9][0-9]*)$");

export function parseRevisionNumber(chainId: string): bigint {
  const match = chainId.match(regexRevNum);
  if (match && match.length >= 2) {
    return BigInt(match[1]);
  }
  return BigInt(0);
}

export function getRevisionHeight(height: number, chainId: string): Height {
  return Height.fromPartial({
    revisionHeight: BigInt(height),
    revisionNumber: parseRevisionNumber(chainId),
  });
}

async function getValidatorSet(
  chain: Chain,
  height: number
): Promise<ValidatorSet> {
  const block = await chain.lcd.tendermint.blockInfo(height);
  const proposerAddress = block.block.header.proposer_address;
  // we need to query the header to find out who the proposer was, and pull them out
  const validators = await chain.rpc.validatorsAll(height);
  let proposer: Validator;
  let totalVotingPower = BigInt(0);
  const mappedValidators: Validator[] = validators.validators.map((val) => {
    const validator = {
      address: val.address,
      pubKey:
        val.pubkey.algorithm === "ed25519"
          ? {
              ed25519: val.pubkey.data,
            }
          : {
              secp256k1: val.pubkey.data,
            },
      votingPower: val.votingPower,
      proposerPriority: val.proposerPriority
        ? BigInt(val.proposerPriority)
        : undefined,
    };
    if (proposerAddress === Buffer.from(val.address).toString("base64")) {
      proposer = validator;
    }
    totalVotingPower = totalVotingPower + val.votingPower;
    return validator;
  });

  return ValidatorSet.fromPartial({
    validators: mappedValidators,
    totalVotingPower,
    proposer,
  });
}
