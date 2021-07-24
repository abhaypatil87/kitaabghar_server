import * as Joi from "joi";
import * as bcrypt from "bcryptjs";
import * as jwt from "jsonwebtoken";
import database from "../database";
import { SUCCESS } from "../utils/enums";
import { User } from "../utils/declarations";

const userSchema = Joi.object({
  user_id: Joi.number().integer(),
  first_name: Joi.string().min(1).max(50).required(),
  last_name: Joi.string().min(1).max(50).required(),
  email: Joi.string().required(),
  password: Joi.string().required(),
  external_id: Joi.any(),
});

/*
 * Creates a user account
 */
async function createUserAccount(user: User) {
  try {
    let hashedPassword = null;
    if (user.password !== "") {
      hashedPassword = await bcrypt.hash(user.password, 12);
    }
    await database.query("START TRANSACTION");
    let { results } = await database.query(
      `
          INSERT INTO users(first_name, last_name, email, external_id, image_url, password)
          VALUES($1, $2, $3, $4, $5, $6)
          RETURNING *`,
      [
        user.first_name,
        user.last_name,
        user.email,
        user.external_id,
        user.image_url,
        hashedPassword,
      ]
    );
    if (results.length === 0) {
      return undefined;
    }
    return results[0];
  } catch (error) {
    throw error;
  } finally {
    await database.query("COMMIT");
  }
}

/*
 * Finds a user with a given email address
 * If no user found, null is returned
 */
async function findByEmailAddress(email: string): Promise<User> {
  try {
    let { results } = await database.query(
      `
          SELECT user_id, first_name, last_name, email, external_id, password, image_url
          FROM users
          WHERE LOWER(email) = '${email}'
          LIMIT 1`
    );
    return results.length > 0 ? results[0] : null;
  } catch (error) {
    throw error;
  }
}

function getExternalId(external: string) {
  return external === "GOOGLE" ? 1 : 0;
}

const signOut = async (ctx) => {
  const request = ctx.request.body;
  console.log(request);
};

const signIn = async (ctx) => {
  const request = ctx.request.body;
  const { first_name, last_name, email, password, external, image_url } =
    request;
  try {
    let existingUser = await findByEmailAddress(email);
    if (existingUser !== null) {
      if (existingUser.external_id !== null) {
        if (password && password.length > 0) {
          ctx.response.status = 400;
          ctx.throw(
            `There exists already an account using this email associated with Social media.`
          );
        }
      } else {
        if (!external) {
          const isPasswordCorrect = await bcrypt.compare(
            request.password,
            existingUser.password
          );
          if (!isPasswordCorrect) {
            ctx.response.status = 400;
            ctx.throw(`Incorrect password. Please try again.`);
          }
        } else {
          ctx.response.status = 400;
          ctx.throw(
            `The exists already an account with this email. Please login with a password.`
          );
        }
      }
    }

    /* If a user is signing in for the very first with external login details, (Google etc.)
     * we must create an internal account first and let the user sign-in
     */
    if (!existingUser) {
      if (external) {
        existingUser = await createUserAccount({
          first_name: first_name || "",
          last_name: last_name || "",
          email: email,
          password: "",
          image_url: image_url || "",
          external_id: getExternalId(external),
        });
      } else {
        ctx.response.status = 404;
        ctx.throw(`No user found with the email ID '${email}'`);
      }
    }

    const token = jwt.sign(
      {
        email: existingUser.email,
        id: existingUser.user_id,
      },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_ACCESS_TOKEN_EXP }
    );

    ctx.body = {
      status: SUCCESS,
      message: `Login successful`,
      data: {
        user: { ...existingUser, token },
      },
    };
  } catch (error) {
    ctx.response.status = 500;
    ctx.throw(
      error.message || "Failed to authenticate. Please try again later."
    );
  }
};

const signUp = async (ctx) => {
  const request = ctx.request.body;

  try {
    const existingUser = await findByEmailAddress(request.email);
    if (existingUser !== null) {
      ctx.response.status = 400;
      ctx.throw(
        `There exists a user with the specified email ID '${request.email}'`
      );
    }

    const validator = userSchema.validate(request);
    if (validator.error) {
      ctx.response.status = 400;
      ctx.throw(validator.error.details[0].message);
    }

    const newUser = await createUserAccount(request);
    const token = jwt.sign(
      {
        email: request.email,
        id: newUser,
      },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_ACCESS_TOKEN_EXP }
    );
    ctx.body = {
      status: SUCCESS,
      message: `Sign Up successful`,
      data: {
        user: { ...newUser, token },
      },
    };
  } catch (error) {
    ctx.response.status = 500;
    ctx.throw(
      error.message || "Error occurred while signing up. Please try again soon!"
    );
  }
};

const authController = {
  signIn,
  signOut,
  signUp,
};

export default authController;
