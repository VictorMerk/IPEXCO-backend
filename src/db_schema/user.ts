import mongoose, { Document, Schema } from 'mongoose';
import * as bcrypt from 'bcrypt';
import * as jwt from 'jsonwebtoken';

export type UserRole = 'admin' | 'creator' | 'user-study'

export interface UserData{
    _id?: string;
    name: string;
    role: UserRole;
}

export interface User{
    _id: string;
    name: string;
    role: UserRole;
    password: string | null;
    tokens: { token: string }[];

    generateAuthToken: () => Promise<string>;
    findByCredentials: (username: string, password: string) => User;
}

const UserSchema =  new Schema<User>({
    name: {type: String, required: true,trim: true},
    role: {type: String, required: true},
    password: {type: String, required: true, minLength: 7},
    tokens: [{token: {type: String, required: true}}]
}, { timestamps: true});


UserSchema.pre('save', async function (next) {
    // Hash the password before saving the user model
    const user = this;
    if (user.password != null && user.isModified('password')) {
        user.password = await bcrypt.hash(user.password, 8);
    }
    next();
});

UserSchema.methods.generateAuthToken = async function() {
    // Generate an auth token for the user
    const user = this;
    const jwtKey = process.env.JWT_KEY;
    if (!jwtKey) {
        throw new Error('JWT_KEY must be configured before issuing authentication tokens.');
    }
    const token: string = jwt.sign({ _id: user._id}, jwtKey );
    user.tokens = user.tokens.concat([{ token }]);
    await user.save();
    return token;
};

UserSchema.statics.findByCredentials = async (username: string, password: string) => {

    const user: User | null = await UserModel.findOne({ name: username} );
    if (!user) {
        return null;
    }
    if (! user.password){
        return null;
    }
    if (user.role =='user-study'){
        return null;
    }
    const isPasswordMatch = await bcrypt.compare(password, user.password);
    if (!isPasswordMatch) {
        return null;
    }
    return user;
};

export const UserModel = mongoose.model<User>('User', UserSchema);
